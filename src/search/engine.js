/**
 * @file 搜尋引擎：載入 docs.json 與 lexicon.json，提供族語模糊搜尋、例句搜尋、
 * 中文與英文釋義搜尋、跨來源相近詞。
 *
 * 網站把它放在 Web Worker 中執行，避免阻塞畫面；也可在 Node.js 中直接使用（測試即如此）。
 *
 * ## 四種資料結構
 * 1. **族語（模糊）**：序列化的詞圖 DAWG（FuzzyIndex），以加權編輯距離搜尋；
 *    每個詞的 posting 指出它是哪些記錄的詞形、變體、詞根，或出現在哪些句子中。
 * 2. **族語（前綴／包含）**：「字元 → 詞」反向索引。加權編輯距離只適合「長度相近、拼寫相近」的詞，
 *    查 `pihi` 找不到 `pihilut`（要刪 3 個字元），查單一字母 `k` 更是無從比對。
 *    這一層補上這兩種需求，兩者的結果合併後再分組排序（見 `_matchTerms`）。
 * 3. **中文釋義**：「單字 → 記錄」反向索引，查詢時取各字 posting 的交集再驗證子字串。
 * 4. **英文／臺語羅馬字釋義**：「詞 → 記錄」反向索引，另保留排序後的詞表以支援前綴查詢。
 * 除了詞圖之外，其餘索引都在第一次用到時才建立（lazy）。
 */

import { createMorphSearch, EPSILON, FuzzyIndex, roundCost } from '../fuzzy/index.js'
import { atomsOf } from '../pattern/ast.js'
import { PatternError } from '../pattern/errors.js'
import { parsePattern } from '../pattern/parser.js'
import { PatternSearch } from '../pattern/search.js'
import { createVirtualRootSearch, DerivationGraph, isLexicalRoot, SIBLING_MAX_SOUND, soundOf, virtualRootCost, virtualRoots } from './derivations.js'
import { buildEntryGroups, collectHits, mergeSpellings } from './family.js'
import { ParseChart } from './parses.js'
import { decodePosting, docAt, INDEX_FORMAT_VERSION } from './format.js'
import {
  alternativesOf,
  compareHits,
  compareOccurrences,
  KIND_RANK,
  MATCH_TYPE_RANK,
  MATCH_TYPES,
  mergeMorphMatch,
  methodOf,
  recordScore,
  replacesRecordHit,
  ROLE_RANK,
  SEARCH_METHOD_GROUPS,
  SEARCH_METHODS,
  siblingTier,
  termScore,
} from './scoring.js'
import { createTextTools, detectQueryMode, glossTokens, zhNormalize } from './text.js'

/**
 * 模糊程度：依查詢長度 n（code point）決定距離門檻。
 * normalization 一律用 'max'（距離 ÷ 較長字串長度），避免短查詢配到長詞。
 */
export const FUZZINESS = Object.freeze({
  exact: { label: '精確', maxDistance: () => 0, maxNormalized: Infinity, derivedFromAll: false },
  normal: { label: '標準', maxDistance: (n) => clamp(0.2 + 0.15 * n, 0.3, 1.6), maxNormalized: 0.3, derivedFromAll: false },
  // 寬鬆：所有模糊命中都當詞根去找自動派生形（標準只用查詢本身與方言變體）
  loose: { label: '寬鬆', maxDistance: (n) => clamp(0.5 + 0.25 * n, 0.8, 3), maxNormalized: 0.5, derivedFromAll: true },
})

/** @typedef {keyof typeof FUZZINESS} Fuzziness */

/**
 * @typedef {object} SearchFilters
 * @property {string[]} [sources] 只保留這些來源
 * @property {string[]} [dialects] 只保留含這些方言的記錄；特殊值 'none' 代表「未標方言」
 * @property {string[]} [units] 只保留這些單位
 * @property {string[]} [statuses] 只保留這些校對狀態
 */

/**
 * @typedef {object} ListOptions
 * @property {SearchFilters} [filters]
 * @property {'text' | 'source'} [sort='text'] text 依詞形排序；source 依來源內原本的順序
 * @property {number} [offset=0]
 * @property {number} [limit=100]
 */

/**
 * @typedef {object} SearchOptions
 * @property {Fuzziness} [fuzziness='normal']
 * @property {SearchFilters} [filters]
 * @property {string[]} [fields] 要搜尋的部分：'native' 族語、'gloss' 釋義；預設兩者都搜
 * @property {number} [limit=500] 每個區塊最多回傳筆數
 * @property {number} [explainLimit=40] 為前幾筆模糊詞條附上對齊說明
 * @property {import('./scoring.js').SearchMethod[]} [exclude] 不要的搜尋方法（見 scoring.js 的 SEARCH_METHODS）：
 *   每筆記錄只在剩下的方法中挑最好的命中，被排除的方法不會壓在其他方法底下
 */

/**
 * @typedef {object} AlignmentNote 模糊命中時，非相同字元的對齊步驟
 * @property {string} op
 * @property {string} source
 * @property {string} target
 * @property {number} cost
 * @property {string | null} category 規則分類（例如「閃音」）
 */

/**
 * @typedef {object} EntryHit 詞條命中
 * @property {import('./format.js').DocSummary} doc
 * @property {string} term 命中的詞庫詞（搜尋鍵）
 * @property {number} distance 加權編輯距離；前綴／包含命中為 0
 * @property {number} score 排序用的等效距離（見 scoring.js）
 * @property {MatchType} matchType 以哪一種方式命中
 * @property {import('./format.js').MatchKind | 'parent' | 'sibling'} kind 詞與記錄的關係；root、parent、sibling 是辭典標註的構詞關係
 *   （確定派生、確定拆解、確定同根，見 scoring.js 的 KIND_RANK）
 * @property {string} [via] 確定同根時，兩者共同的上層（辭典中的詞形）
 * @property {boolean} [direct] 這筆記錄有沒有被查詢直接命中（不只經由辭典的構詞關係）；家族的排序只把直接的命中算成證據
 * @property {AlignmentNote[] | null} alignment
 * @property {LemmaAnalysis | null} [analysis] 構詞分析：自動拆解（matchType 'lemma'）時是查詢的分析，
 *   自動派生（matchType 'derived'）時是命中詞的分析
 */

/**
 * @typedef {AlignmentNote & {where: 'prefix' | 'stem' | 'suffix' | 'junction'}} MorphNote
 *   構詞命中的一個音變：落在前綴、詞幹、後綴，或詞素交界（交界上的增生、跨越交界的規則）
 */

/**
 * @typedef {object} LemmaAnalysis
 * @property {string} stem 詞幹（詞庫中的寫法）
 * @property {Array<import('../fuzzy/morph-search.js').MorphStepHit>} steps 由外而內的構詞步驟
 * @property {number} cost 總成本：構詞步驟＋整個詞的音變（docs/bcdp.md 1.2）
 * @property {string} [variantOf] 自動派生以查詢的相近寫法當起點時，查詢本身
 * @property {number} [variantDistance] 查詢 → 起點的距離
 * @property {AlignmentNote[]} [variantNotes] 查詢 → 起點的對齊說明
 * @property {Array<{term: string, stem: string, steps: Array<import('../fuzzy/morph-search.js').MorphStepHit>, cost: number}>} [chain]
 *   自動派生經過其他詞時，由起點往下的每一層（不含最後一層，那一層就是 stem、steps）：
 *   查 sungut 找到 pausunguday，chain 是 [pusungut ＝ pu- ＋ sungut]，stem 是 pusungut
 * @property {MorphNote[] | null} [notes] 整個詞的音變說明（自動拆解只為前幾筆結果計算）
 * @property {{root: string, steps: Array<import('../fuzzy/morph-search.js').MorphStepHit>, cost: number, penalty: number, lexical: boolean}} [sibling]
 *   自動同根（matchType 'sibling'）：查詢拆出的詞根 root 與拆法；stem、steps、chain 是這個詞往上到 root 的路。
 *   lexical：root 是詞庫中的詞（查 kali'angidan：root 是 angit，這個詞 'inangidan ＝ ‹in› ＋ 'angit ＋ -an，penalty 是 0）；
 *   否則是虛擬詞根（查 binubuer：root 是 bubuer（b<in>ubuer），這個詞 mabubuer ＝ ma- ＋ bubuer；
 *   penalty 是詞庫外詞根的代價 virtualRootCost）
 * @property {number} [bestCost] 句型搜尋的構詞樣式：這個詞最好的拆法的成本；比 cost 小時，這一種是次佳的拆法
 * @property {boolean} [virtual] 句型搜尋的構詞樣式：詞根（stem）是虛擬詞根，不在詞庫中
 */

/** @typedef {import('./scoring.js').MatchType} MatchType */

/**
 * @typedef {object} TermMatch 一個查詢詞在詞庫中的命中
 * @property {string} term
 * @property {unknown[]} payloads
 * @property {number} distance
 * @property {MatchType} matchType
 * @property {number} [score] 已經定下的分數（開頭相符又能自動派生時取兩者較好的；見 scoring.js 的 mergeMorphMatch）
 * @property {LemmaAnalysis} [analysis] 構詞命中（lemma 自動拆解、derived 自動派生）的分析
 */

/**
 * @typedef {object} OccurrenceHit 例句命中
 * @property {import('./format.js').DocSummary} doc
 * @property {string[]} terms 句中命中的詞（搜尋鍵），供前端高亮
 * @property {number} distance 各查詢詞距離總和
 * @property {number} score 排序用的等效距離總和
 * @property {MatchType} matchType 各查詢詞中最弱的命中方式
 * @property {OccurrenceMatch[]} matches 每個查詢詞在這一句中決定分數的命中（說明標籤用）
 */

/**
 * @typedef {object} OccurrenceMatch 例句中一個查詢詞的命中（欄位與 EntryHit 相同，介面共用同一套標籤）
 * @property {string} word 查詢詞
 * @property {string} term 查詢命中的詞庫詞（搜尋鍵）；kind 為 root 時是詞根，句中的詞在 token
 * @property {string} token 句中命中的詞（搜尋鍵）
 * @property {'token' | 'root' | 'parent' | 'sibling'} kind token：句中的詞就是 term；其他是辭典標註的構詞關係
 *   （root：句中的詞是 term 的下層，查 usa 句中的 mukusa；parent：上層；sibling：同一個上層；見 _dictionaryRelations）
 * @property {string} [via] 確定同根時，共同的上層
 * @property {MatchType} matchType
 * @property {number} distance
 * @property {AlignmentNote[] | null} alignment 模糊命中的對齊說明（只為前幾句計算）
 * @property {LemmaAnalysis | null} analysis 構詞命中的分析
 */

/**
 * @typedef {object} GlossHit 釋義命中
 * @property {import('./format.js').DocSummary} doc
 * @property {'zh' | 'en' | 'nan'} field
 * @property {number} rank 0 完全相同、1 開頭相同、2 整詞、3 部分
 */

/**
 * @typedef {object} SearchResponse
 * @property {string} query
 * @property {'zh' | 'latin'} mode
 * @property {Array<{term: string, distance: number}>} terms 模糊搜尋命中的詞庫詞
 * @property {EntryHit[]} entries 詞條命中，依分數排序
 * @property {import('./family.js').EntryGroup[]} entryGroups 同樣的詞條命中，依詞條家族分組（畫面顯示用，見 family.js）
 * @property {OccurrenceHit[]} occurrences
 * @property {GlossHit[]} glosses
 * @property {{entries: number, entryGroups: number, occurrences: number, glosses: number}} totals 截斷前的總數
 * @property {Record<import('./scoring.js').SearchMethod, number>} methods 每種搜尋方法找得到幾筆記錄（詞條與例句；
 *   不受 exclude 影響，介面用來顯示每個方法的數量）
 * @property {Record<import('./scoring.js').SearchMethodGroup, number>} methodGroups 每一組搜尋方法（SEARCH_METHOD_GROUPS）找得到幾筆記錄：
 *   組內各方法的聯集，一筆記錄同時屬於組內好幾種方法時只算一次；同樣不受 exclude 影響
 * @property {{elapsedMs: number, visitedNodes: number}} stats
 */

/** 構詞搜尋的總成本上限：min(LEMMA_MAX_DISTANCE, 模糊程度門檻 ＋ LEMMA_EXTRA_DISTANCE) */
const LEMMA_MAX_DISTANCE = 1
const LEMMA_EXTRA_DISTANCE = 0.6

/** 查詢的方言變體也拿來找自動派生形：只取距離這麼小、且全由方言規則構成的模糊命中 */
const DIALECT_VARIANT_DISTANCE = 0.3

/** 前綴／包含比對每個查詢詞最多取幾個詞，避免單字母查詢產生過多結果 */
const SUBSTRING_TERM_LIMIT = 300

/** 英文釋義搜尋忽略的虛詞 */
const GLOSS_STOPWORDS = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'is', 'be', 'and', 'or', 'for', 'with'])

export class SearchEngine {
  /**
   * @param {{
   *   docs: import('./format.js').SearchDocs,
   *   lexicon: import('../fuzzy/fuzzy-index.js').SerializedIndex,
   *   profile: import('../fuzzy/profile.js').LanguageProfile,
   *   derivations?: import('./derivations.js').DerivationData | null,
   *   parses?: import('./derivations.js').DerivationData | null,
   * }} data `profile` 必須是建索引時用的同一份語言設定檔（建置輸出的 search/language.json）；
   *   `derivations` 是自動派生圖（search/derivations.json，見 derivations.js），沒有時不找自動派生形；
   *   `parses` 是拆解表（search/parses.json，見 parses.js），句型搜尋的構詞樣式要用。網站在第一次需要時才載入，
   *   之後以 attachParseChart 接上（needsParseChart 判斷要不要）
   */
  constructor({ docs, lexicon, profile, derivations = null, parses = null }) {
    if (docs.version !== INDEX_FORMAT_VERSION) {
      throw new Error(`搜尋索引格式版本 ${docs.version} 與框架（${INDEX_FORMAT_VERSION}）不符，請重新建置網站`)
    }
    this.docs = docs
    this.text = createTextTools(profile)
    this.metric = this.text.createSearchMetric()
    this.index = FuzzyIndex.deserialize(lexicon, this.metric)
    /** 構詞搜尋 BCDP（語言設定檔有 morphology 時才有），見 babizu/fuzzy 的 morph-search.js 與 docs/bcdp.md */
    this.morphSearch = this.text.morphology
      ? createMorphSearch({ analyzer: this.text.morphology, metric: this.metric, index: this.index })
      : null
    /** @type {ReturnType<typeof createMorphSearch> | null} 虛擬詞根用的構詞搜尋（第一次用到時建立，virtualRootSearch） */
    this._virtualRootSearch = null
    /** @type {Map<string, number> | null} */
    this._idIndex = null
    /** @type {Map<number, number[]> | null} 下層記錄（_childrenOf） */
    this._children = null
    /** @type {Map<string, number[]> | null} */
    this._zhIndex = null
    /** @type {{tokens: Map<string, Array<[number, 'en' | 'nan']>>, sorted: string[]} | null} */
    this._glossIndex = null
    /** @type {{terms: string[], byChar: Map<string, number[]>, byPair: Map<string, number[]>} | null} */
    this._termIndex = null
    /** @type {{key: string, indices: number[]} | null} */
    this._listCache = null
    /** @type {WeakMap<LemmaAnalysis, () => MorphNote[]>} 構詞命中的音變說明（需要時才計算） */
    this._lazyNotes = new WeakMap()
    /** @type {Map<string, Array<{doc: number, kind: 'root' | 'parent' | 'sibling', depth: number, via?: string}>>} 詞 → 辭典標註的構詞關係（_dictionaryRelations） */
    this._relations = new Map()
    /** @type {Set<string> | null} 構詞規格中的詞綴寫法（_isAffixEntry） */
    this._affixForms = null
    /** 自動派生圖（查詞根找自動派生形，見 derivations.js） */
    this.derivations = derivations && this.morphSearch ? new DerivationGraph(derivations, this.index.terms) : null
    /** @type {ParseChart | null} 拆解表（句型搜尋的構詞樣式用，見 parses.js） */
    this.parses = parses && this.morphSearch ? new ParseChart(parses, this.index.terms) : null
    /** @type {PatternSearch | null} 句型搜尋（第一次用到時建立，見 babizu/pattern） */
    this._pattern = null
  }

  /**
   * 句型搜尋：依詞序與構詞搜尋記錄（docs/pattern-query.md）。
   * @param {string} query 句型查詢，例如 `yaku ka _* isiw`、`pa-… ki _`
   * @param {import('../pattern/search.js').PatternSearchOptions} [options]
   * @returns {import('../pattern/search.js').PatternResponse}
   */
  searchPattern(query, options = {}) {
    if (!this._pattern) this._pattern = new PatternSearch(this)
    return this._pattern.search(query, options)
  }

  /**
   * 這個句型查詢需不需要先載入拆解表：有構詞規格、還沒有拆解表，而且查詢中有構詞樣式。
   * 查詢有語法錯誤時不需要（searchPattern 會回報錯誤）。
   * @param {string} query
   */
  needsParseChart(query) {
    if (!this.morphSearch || this.parses) return false
    try {
      return parsePattern(query).conditions.some((c) => [...atomsOf(c.body)].some((n) => n.atom.kind === 'morph'))
    } catch (err) {
      if (err instanceof PatternError) return false
      throw err
    }
  }

  /**
   * 接上拆解表（網站在第一次需要時才載入 search/parses.json）。
   * @param {import('./derivations.js').DerivationData} data
   */
  attachParseChart(data) {
    if (!this.morphSearch) return
    this.parses = new ParseChart(data, this.index.terms)
    this._pattern?.reset()
  }

  /**
   * 模糊程度的設定（不認得的名稱當成標準）。
   * @param {Fuzziness | string} fuzziness
   */
  _level(fuzziness) {
    return FUZZINESS[/** @type {Fuzziness} */ (fuzziness)] ?? FUZZINESS.normal
  }

  /**
   * 構詞搜尋的總成本上限：min(1, 該模糊程度的門檻 ＋ 0.6)。
   * @param {string} key
   * @param {typeof FUZZINESS[Fuzziness]} level
   */
  _lemmaMax(key, level) {
    return Math.min(LEMMA_MAX_DISTANCE, level.maxDistance(Array.from(key).length) + LEMMA_EXTRA_DISTANCE)
  }

  /**
   * 預先建立釋義索引，讓第一次查詢不必等待（適合在 Worker 載入完成後呼叫）。
   */
  warmup() {
    this._ensureZhIndex()
    this._ensureGlossIndex()
    this._ensureTermIndex()
    this.docById('')
  }

  /**
   * 構詞搜尋（BCDP）的完整說明，給演算法實驗室逐步展示（docs/lab-design.md）。
   * 查詢與詞根都先轉成搜尋鍵；總成本上限與搜尋相同，所以 hit 就是搜尋對這個詞根的結果。
   * @param {string} query
   * @param {string | null} [term] 要逐格計價的詞根（省略時只列出命中）
   * @param {{fuzziness?: Fuzziness}} [options]
   * @returns {ReturnType<NonNullable<SearchEngine['morphSearch']>['explain']> | null} 語言設定檔沒有構詞規格時為 null
   */
  explainMorphology(query, term = null, { fuzziness = 'normal' } = {}) {
    if (!this.morphSearch) return null
    const key = this.text.searchKey(query)
    const level = FUZZINESS[fuzziness] ?? FUZZINESS.normal
    return this.morphSearch.explain(key, term === null ? null : this.text.searchKey(term), { maxDistance: this._lemmaMax(key, level) })
  }

  /**
   * 清掉跨查詢的快取（構詞搜尋的詞綴鏈），不影響結果。量測「沒有快取」的耗時時用。
   */
  clearCaches() {
    this.morphSearch?.clearCache()
    this._virtualRootSearch?.clearCache()
  }

  /**
   * 虛擬詞根用的構詞搜尋（只有構詞音變的距離函式，derivations.js 的 createVirtualRootSearch）；
   * 語言設定檔沒有 morphology 時為 null。第一次用到時建立。
   * @returns {ReturnType<typeof createMorphSearch> | null}
   */
  get virtualRootSearch() {
    if (!this.morphSearch) return null
    return (this._virtualRootSearch ??= createVirtualRootSearch(this.text, this.index))
  }

  /** 記錄總數 */
  get size() {
    return this.docs.count
  }

  /**
   * 資料中的下層記錄（docs.parent 的反向對照，第一次用到時建立）。
   * @param {number} k
   * @returns {readonly number[]}
   */
  _childrenOf(k) {
    if (!this._children) {
      /** @type {Map<number, number[]>} */
      const map = new Map()
      this.docs.parent.forEach((p, c) => {
        if (p === -1) return
        const list = map.get(p)
        if (list) list.push(c)
        else map.set(p, [c])
      })
      this._children = map
    }
    return this._children.get(k) ?? []
  }

  /** @param {number} k */
  doc(k) {
    return docAt(this.docs, k)
  }

  /**
   * 依記錄 id 取得摘要。
   * @param {string} id
   */
  docById(id) {
    if (!this._idIndex) this._idIndex = new Map(this.docs.id.map((x, k) => [x, k]))
    const k = this._idIndex.get(id)
    return k === undefined ? null : this.doc(k)
  }

  /**
   * 主搜尋。
   * @param {string} query
   * @param {SearchOptions} [options]
   * @returns {SearchResponse}
   */
  search(query, options = {}) {
    const started = now()
    const {
      fuzziness = 'normal',
      filters = {},
      fields = ['native', 'gloss'],
      limit = 500,
      explainLimit = 40,
      exclude = [],
    } = options
    const searchNative = fields.includes('native')
    const searchGloss = fields.includes('gloss')
    const q = String(query ?? '').trim()
    const mode = detectQueryMode(q)
    /** @type {SearchResponse} */
    const response = {
      query: q,
      mode,
      terms: [],
      entries: [],
      entryGroups: [],
      occurrences: [],
      glosses: [],
      totals: { entries: 0, entryGroups: 0, occurrences: 0, glosses: 0 },
      methods: /** @type {SearchResponse['methods']} */ (Object.fromEntries(SEARCH_METHODS.map((m) => [m, 0]))),
      methodGroups: /** @type {SearchResponse['methodGroups']} */ (Object.fromEntries(Object.keys(SEARCH_METHOD_GROUPS).map((g) => [g, 0]))),
      stats: { elapsedMs: 0, visitedNodes: 0 },
    }
    if (!q) return response

    const accept = this._createFilter(filters)
    if (searchNative) {
      // 中文查詢對族語欄位只做「包含」比對：族語欄位中可能夾雜中文註記（形如「族語詞 中文詞」），
      // 但加權編輯距離對中文沒有意義
      this._searchNative(q, FUZZINESS[fuzziness] ?? FUZZINESS.normal, accept, response, explainLimit, {
        fuzzy: mode === 'latin',
        exclude: new Set(exclude),
      })
    }
    if (searchGloss) {
      response.glosses = mode === 'zh' ? this._searchZh(q, accept) : this._searchLatinGloss(q, accept)
    }

    response.totals = {
      entries: response.entries.length,
      entryGroups: response.entryGroups.length,
      occurrences: response.occurrences.length,
      glosses: response.glosses.length,
    }
    // 上限只算原本的命中；自動同根（已排在最後）另外全列，不擠掉原本的（siblingTier）
    /** @template T @param {T[]} list @param {(x: T) => number} tier */
    const capped = (list, tier) => {
      const own = list.filter((x) => tier(x) === 0)
      return own.length < list.length ? [...own.slice(0, limit), ...list.filter((x) => tier(x) !== 0)] : list.slice(0, limit)
    }
    response.entries = capped(response.entries, siblingTier)
    response.entryGroups = capped(response.entryGroups, (g) => siblingTier(g.best))
    response.occurrences = capped(response.occurrences, siblingTier)
    response.glosses = response.glosses.slice(0, limit)
    response.stats.elapsedMs = Math.round((now() - started) * 10) / 10
    return response
  }

  /**
   * 依條件列出記錄（不搜尋，用於「資料來源」頁的詞彙清單）。
   *
   * 直接用已載入的摘要索引篩選與排序，不需要另外下載分片檔案。
   * 相同條件的排序結果會快取，翻頁時不必重排。
   *
   * @param {ListOptions} [options]
   * @returns {{items: import('./format.js').DocSummary[], total: number}}
   */
  list({ filters = {}, sort = 'text', offset = 0, limit = 100 } = {}) {
    const key = JSON.stringify([filters, sort])
    let indices = this._listCache?.key === key ? this._listCache.indices : null
    if (!indices) {
      const accept = this._createFilter(filters)
      indices = []
      for (let k = 0; k < this.docs.count; k++) if (accept(k)) indices.push(k)
      if (sort === 'text') {
        const keys = new Map(indices.map((k) => [k, this.text.searchKey(this.docs.text[k])]))
        indices.sort((a, b) => {
          const ka = /** @type {string} */ (keys.get(a))
          const kb = /** @type {string} */ (keys.get(b))
          return ka < kb ? -1 : ka > kb ? 1 : a - b
        })
      }
      this._listCache = { key, indices }
    }
    return {
      total: indices.length,
      items: indices.slice(offset, offset + limit).map((k) => this.doc(k)),
    }
  }

  /**
   * 跨來源相近詞：與指定記錄詞形相近、但不屬於同一群組的詞條。
   * @param {string} id 記錄 id
   * @param {{fuzziness?: Fuzziness, limit?: number}} [options]
   * @returns {EntryHit[]}
   */
  neighbors(id, { fuzziness = 'normal', limit = 20 } = {}) {
    const doc = this.docById(id)
    if (!doc || doc.unit === 'sentence') return []
    const key = this.text.searchKey(doc.text)
    if (!key) return []
    const level = FUZZINESS[fuzziness] ?? FUZZINESS.normal
    const n = Array.from(key).length
    const terms = this.index.search(key, {
      maxDistance: level.maxDistance(n),
      normalization: 'max',
      maxNormalized: level.maxNormalized,
    })

    /** @type {Map<number, EntryHit>} */
    const best = new Map()
    for (const t of terms) {
      for (const code of /** @type {number[]} */ (t.payloads)) {
        const { doc: k, kind } = decodePosting(code)
        if (kind === 'token' || kind === 'root' || k === doc.index) continue
        if (doc.groupId && this.docs.groupId[k] === doc.groupId) continue
        const prev = best.get(k)
        if (!prev || t.distance < prev.distance) {
          best.set(k, {
            doc: this.doc(k),
            term: t.term,
            distance: t.distance,
            score: t.distance,
            matchType: /** @type {MatchType} */ ('fuzzy'),
            kind,
            alignment: null,
          })
        }
      }
    }
    const hits = sortEntries([...best.values()]).slice(0, limit)
    for (const hit of hits) hit.alignment = this.explainNotes(key, hit.term)
    return hits
  }

  /**
   * 兩個詞的對齊說明（只列出非相同字元的步驟）。
   * @param {string} query
   * @param {string} term
   * @returns {AlignmentNote[]}
   */
  explainNotes(query, term) {
    return this.metric
      .align(query, term)
      .filter((s) => s.op !== 'match')
      .map((s) => ({
        op: s.op,
        source: s.source,
        target: s.target,
        cost: s.cost,
        category: s.rule?.category ?? null,
      }))
  }

  /**
   * 族語搜尋：詞條（詞形、變體、詞根、其他寫法）＋ 例句（句中出現）。
   *
   * 每個查詢詞先取得「命中的詞庫詞」清單（模糊＋前綴＋包含，見 `_matchTerms`），
   * 再依 posting 分成詞條與例句兩區。
   *
   * @param {string} q
   * @param {typeof FUZZINESS[Fuzziness]} level
   * @param {(k: number) => boolean} accept
   * @param {SearchResponse} response
   * @param {number} explainLimit
   * @param {{fuzzy?: boolean, exclude?: Set<string>}} [mode] fuzzy=false 時只做前綴／包含比對；exclude 是不要的搜尋方法
   * @private
   */
  _searchNative(q, level, accept, response, explainLimit, { fuzzy = true, exclude = new Set() } = {}) {
    const key = this.text.searchKey(q)
    if (!key) return
    const words = this.text.splitWords(q)

    const fullTerms = this._matchTerms(key, level, response, fuzzy)
    response.terms = fullTerms
      .filter((t) => t.matchType === 'fuzzy')
      .slice(0, 30)
      .map(({ term, distance }) => ({ term, distance }))

    // 每種搜尋方法找得到哪些記錄（數量給介面顯示；不受 exclude 影響）
    /** @type {Map<string, Set<number>>} */
    const byMethod = new Map(SEARCH_METHODS.map((m) => [m, new Set()]))
    /** 記下一個命中的方法，回傳是否保留（沒有被排除） @param {number} k @param {{matchType: MatchType, distance: number, kind?: string}} h */
    const admit = (k, h) => {
      const method = methodOf(h)
      byMethod.get(method)?.add(k)
      return !exclude.has(method)
    }

    // 詞條：整個查詢對應詞庫詞。每個詞依序試它的命中與被它取代的命中（alternativesOf），用第一個沒被排除的
    /** @type {Map<number, EntryHit>} */
    const entries = new Map()
    for (const t of fullTerms) {
      for (const code of /** @type {number[]} */ (t.payloads)) {
        const { doc: k, kind } = decodePosting(code)
        if (kind === 'token' || !accept(k)) continue
        /** @type {TermMatch | null} */
        let chosen = null
        for (const c of alternativesOf(t)) {
          if (!usablePosting(c.matchType, kind)) continue
          if (admit(k, { matchType: c.matchType, distance: c.distance, kind }) && !chosen) chosen = c
        }
        if (!chosen) continue
        const prev = entries.get(k)
        /** @type {EntryHit} */
        const hit = {
          doc: prev?.doc ?? this.doc(k),
          term: chosen.term,
          distance: chosen.distance,
          // 詞根 posting 是辭典標註的派生關係：排在詞本身之後（與辭典的其他構詞關係同一條規則，scoring.js）
          score: recordScore(termScore(chosen, key), kind === 'root' ? 1 : 0),
          matchType: chosen.matchType,
          kind,
          direct: kind !== 'root' || Boolean(prev?.direct),
          alignment: null,
          analysis: chosen.analysis ?? null,
        }
        if (replacesRecordHit(hit, prev, compareHits)) entries.set(k, hit)
        else if (hit.direct && prev) prev.direct = true
      }
    }
    // 辭典標註的構詞關係（確定拆解、派生、同根）：只從寫法與查詢相同的詞條展開（例句同一條規則，見 _searchOccurrences）
    for (const t of fullTerms) {
      if (t.matchType !== 'fuzzy' || t.distance > 0) continue
      for (const r of this._dictionaryRelations(t)) {
        if (!accept(r.doc) || !admit(r.doc, { matchType: 'fuzzy', distance: 0, kind: r.kind })) continue
        const prev = entries.get(r.doc)
        /** @type {EntryHit} */
        const hit = {
          doc: prev?.doc ?? this.doc(r.doc),
          term: t.term,
          distance: 0,
          score: recordScore(termScore(t, key), r.depth),
          matchType: 'fuzzy',
          kind: r.kind,
          ...(r.via ? { via: r.via } : {}),
          // 經由辭典關係的命中不是獨立的證據；原本已經直接命中的（例如自動拆解到的詞根）仍算
          direct: Boolean(prev?.direct),
          alignment: null,
          analysis: null,
        }
        if (replacesRecordHit(hit, prev, compareHits)) entries.set(r.doc, hit)
      }
    }
    response.entries = sortEntries([...entries.values()])
    // 詞條家族：辭典確認屬於同一個詞條的命中排在一起，詞根條目在最上面；
    // 寫法完全相同的單獨結果再合成同形詞組（family.js）
    response.entryGroups = mergeSpellings(
      buildEntryGroups(response.entries, {
        parent: this.docs.parent,
        children: (k) => this._childrenOf(k),
        doc: (k) => this.doc(k),
        key: (text) => this.text.searchKey(text),
        compareHits,
      }),
    )
    // 對齊與構詞說明只為前幾筆計算：分數最好的幾筆，以及畫面上依家族排列時的前幾列
    /** 同一次搜尋中，同一對（查詢詞, 詞）的對齊只算一次（詞條與許多例句常是同一對） @type {Map<string, AlignmentNote[]>} */
    const aligned = new Map()
    /** @param {string} word @param {{matchType: MatchType, distance: number, term: string, alignment: AlignmentNote[] | null, analysis?: LemmaAnalysis | null}} hit */
    const explainMatch = (word, hit) => {
      if (hit.matchType === 'fuzzy' && hit.distance > 0 && hit.alignment === null) {
        const k = `${word}\u0000${hit.term}`
        let notes = aligned.get(k)
        if (!notes) aligned.set(k, (notes = this.explainNotes(word, hit.term)))
        hit.alignment = notes
      }
      const a = hit.analysis
      if (a && a.notes === undefined) a.notes = this._lazyNotes.get(a)?.() ?? null
    }
    /** @param {EntryHit} hit */
    const explain = (hit) => explainMatch(key, hit)
    for (const hit of response.entries.slice(0, explainLimit)) explain(hit)
    let shown = 0
    for (const group of response.entryGroups) {
      for (const hit of group.spelling ? group.spelling.members.map((m) => m.hit) : collectHits(group.root)) {
        if (shown++ >= explainLimit) break
        explain(hit)
      }
      if (shown >= explainLimit) break
    }

    response.occurrences = this._searchOccurrences(key, words, fullTerms, level, accept, response, fuzzy, exclude, byMethod).filter(
      (o) => !entries.has(o.doc.index),
    )
    for (const [m, docs] of byMethod) response.methods[/** @type {import('./scoring.js').SearchMethod} */ (m)] = docs.size
    for (const [g, ms] of Object.entries(SEARCH_METHOD_GROUPS)) {
      const union = new Set(ms.flatMap((m) => [.../** @type {Set<number>} */ (byMethod.get(m))]))
      response.methodGroups[/** @type {import('./scoring.js').SearchMethodGroup} */ (g)] = union.size
    }
    // 例句的命中說明與詞條相同，也只為前幾句計算
    for (const o of response.occurrences.slice(0, explainLimit)) for (const m of o.matches) explainMatch(m.word, m)
  }

  /**
   * 例句：每個查詢詞都要在句中出現，各詞的分數相加排序。分數與詞條同一套規則（scoring.js）：
   * - 句中的詞就是查詢命中的詞庫詞：詞的分數（完全相同、方言變體、開頭相符、自動拆解、自動派生、包含）；
   * - 句中的詞是辭典列在命中詞條下的派生詞（查 usa，句中的 mukusa）：詞的分數加上派生的層數，
   *   與詞條的「衍生自」（詞根 posting）相同。只從寫法與查詢相同的詞條展開。
   * 同一句同一個查詢詞有好幾種命中時取分數最好的一種，說明標籤（matches）也是那一種。
   * 重複的查詢詞（例如 ma sa kau ma ngit 的 ma）只算一次，走訪統計照樣累加，與逐次計算相同。
   *
   * @param {string} key 整個查詢
   * @param {string[]} words 查詢中的詞
   * @param {TermMatch[]} fullTerms 整個查詢的命中（只有一個詞時直接沿用）
   * @param {typeof FUZZINESS[Fuzziness]} level
   * @param {(k: number) => boolean} accept
   * @param {SearchResponse} response 累加走訪統計
   * @param {boolean} fuzzy
   * @param {Set<string>} exclude 不要的搜尋方法
   * @param {Map<string, Set<number>>} byMethod 每種方法找得到的記錄（累加）
   * @returns {OccurrenceHit[]}
   * @private
   */
  _searchOccurrences(key, words, fullTerms, level, accept, response, fuzzy, exclude, byMethod) {
    /** @type {Map<string, {terms: TermMatch[], visited: number}>} */
    const seen = new Map()
    const matchWord = (/** @type {string} */ word) => {
      if (word === key) return fullTerms
      const prev = seen.get(word)
      if (prev) {
        response.stats.visitedNodes += prev.visited
        return prev.terms
      }
      const before = response.stats.visitedNodes
      const terms = this._matchTerms(word, level, response, fuzzy)
      seen.set(word, { terms, visited: response.stats.visitedNodes - before })
      return terms
    }
    /** @typedef {{distance: number, score: number, rank: number, terms: string[], matches: OccurrenceMatch[]}} Combined */
    /** @type {Map<number, Combined> | null} */
    let combined = null
    for (const word of words.length > 0 ? words : [key]) {
      /** @type {Map<number, Combined>} */
      const found = new Map()
      /** 句中的一個詞落在含它的各句上 @param {unknown[]} payloads @param {number} score @param {OccurrenceMatch} match */
      const place = (payloads, score, match) => {
        const rank = MATCH_TYPE_RANK[match.matchType]
        const next = { matchType: match.matchType, score }
        const method = methodOf(match)
        const excluded = exclude.has(method)
        for (const code of /** @type {number[]} */ (payloads)) {
          const { doc: k, kind } = decodePosting(code)
          if (kind !== 'token' || !accept(k)) continue
          byMethod.get(method)?.add(k)
          if (excluded) continue
          const prev = found.get(k)
          const before = prev && { matchType: MATCH_TYPES[prev.rank], score: prev.score }
          // 只有自動同根命中的句子，遇到其他命中時整個換掉（高亮也只留那一種）；已有其他命中的句子不收自動同根
          if (!prev || (before?.matchType === 'sibling' && match.matchType !== 'sibling')) {
            found.set(k, { distance: match.distance, score, rank, terms: [match.token], matches: [match] })
          } else if (match.matchType === 'sibling' && before?.matchType !== 'sibling') continue
          else {
            prev.terms.push(match.token)
            if (replacesRecordHit(next, before, (a, b) => a.score - b.score)) {
              prev.rank = rank
              prev.score = score
              prev.distance = match.distance
              prev.matches = [match]
            }
          }
        }
      }
      for (const t of matchWord(word)) {
        // 同一個詞的命中與被它取代的命中都放上去：被排除的方法在 place 裡略過，每句仍取剩下的最好的一種
        for (const c of alternativesOf(t)) {
          /** @type {OccurrenceMatch} 同一個物件由含這個詞的各句共用：說明只算一次，每一句都看得到 */
          const match = { word, term: c.term, token: c.term, kind: 'token', matchType: c.matchType, distance: c.distance, alignment: null, analysis: c.analysis ?? null }
          place(c.payloads, recordScore(termScore(c, word)), match)
        }
        // 辭典標註的構詞關係只從「就是查詢那個詞」的詞條展開（搜尋鍵相同）。寫法相近的詞條已經是一層不確定
        // （sungut 與 zenget 只差三條方言規則，卻是不同的詞），再加上辭典的關係就不是查詢的那個詞了；
        // 它們的派生詞仍可經由自動派生找到，分數照實加上寫法的差距
        if (t.matchType !== 'fuzzy' || t.distance > 0) continue
        const score = termScore(t, word)
        const base = { word, term: t.term, matchType: /** @type {MatchType} */ ('fuzzy'), distance: 0, alignment: null, analysis: null }
        for (const d of this._dictionaryTokens(t)) {
          place(d.payloads, recordScore(score, d.depth), { ...base, token: d.term, kind: d.kind, ...(d.via ? { via: d.via } : {}) })
        }
      }
      if (combined === null) {
        combined = found
      } else {
        const next = new Map()
        for (const [k, v] of combined) {
          const w = found.get(k)
          if (w) {
            next.set(k, {
              distance: v.distance + w.distance,
              score: v.score + w.score,
              rank: Math.max(v.rank, w.rank),
              terms: [...v.terms, ...w.terms],
              matches: [...v.matches, ...w.matches],
            })
          }
        }
        combined = next
      }
      if (combined.size === 0) break
    }
    return [...(combined ?? new Map())]
      .map(([k, v]) => ({
        doc: this.doc(k),
        terms: [...new Set(v.terms)],
        distance: Math.round(v.distance * 1e9) / 1e9,
        score: Math.round(v.score * 1e9) / 1e9,
        matchType: /** @type {MatchType} */ (MATCH_TYPES[v.rank]),
        matches: v.matches,
      }))
      .sort(compareOccurrences)
  }

  /**
   * 辭典標註的構詞關係（不是演算法推定的）：以詞 t 為詞形的記錄（「自己」）在詞條家族（docs.parent）中的
   * - 下層（root，確定派生）：條目下的詞形、標明 < t 的另立條目，以及標明由 t 衍生、但接不上家族的記錄（詞根 posting）；
   * - 上層（parent，確定拆解）：自己所屬的條目、自己標明 < 的詞；
   * - 同一個上層的其他詞（sibling，確定同根）：上層的所有下層，扣掉自己這一支。上層是詞綴的條目（<in>、mina-：
   *   辭典把帶這個詞綴的詞列為例子）時不算：那是同一個詞綴，不是同一個詞根。詞綴由語言設定檔的構詞規格判斷（_isAffixEntry）。
   * 層數：上層、下層各算一層，同根是往上的層數加往下的層數。只收詞與詞綴，不收片語與例句。
   * 查 usa：mukusa（p.204 另立條目「< usa」、usa 條下的詞形）是下層；查 mukawas：kawas- 是上層，
   * kawas- 條下的其他詞是同根。
   *
   * @param {TermMatch} t
   * @returns {Array<{doc: number, kind: 'root' | 'parent' | 'sibling', depth: number, via?: string}>} 每筆記錄取最淺的一種
   * @private
   */
  _dictionaryRelations(t) {
    const cached = this._relations.get(t.term)
    if (cached) return cached
    const docs = this.docs
    const isWord = (/** @type {number} */ k) => {
      const unit = docs.units[docs.unit[k]]
      return unit === 'word' || unit === 'affix'
    }
    /** @type {Set<number>} 以 t 為詞形的記錄 */
    const self = new Set()
    /** @type {number[]} 標明由 t 衍生的記錄（詞根 posting） */
    const marked = []
    for (const code of /** @type {number[]} */ (t.payloads)) {
      const { doc: k, kind } = decodePosting(code)
      if (kind === 'root') marked.push(k)
      else if (kind !== 'token') self.add(k)
    }
    /** 由 starts 往下走，每筆記錄的最淺層數 @param {Array<[number, number]>} starts */
    const below = (starts) => {
      /** @type {Map<number, number>} */
      const depth = new Map()
      const queue = [...starts].sort((a, b) => a[1] - b[1])
      while (queue.length) {
        const [k, d] = /** @type {[number, number]} */ (queue.shift())
        if (depth.has(k)) continue
        depth.set(k, d)
        for (const c of this._childrenOf(k)) queue.push([c, d + 1])
      }
      return depth
    }
    const down = below([...[...self].map((k) => /** @type {[number, number]} */ ([k, 0])), ...marked.map((k) => /** @type {[number, number]} */ ([k, 1]))])
    /** @type {Map<number, number>} 上層與層數 */
    const up = new Map()
    for (const k of self) {
      for (let p = docs.parent[k], d = 1; p !== -1 && !up.has(p); p = docs.parent[p], d++) up.set(p, d)
    }
    /** @type {Map<number, {doc: number, kind: 'root' | 'parent' | 'sibling', depth: number, via?: string}>} */
    const out = new Map()
    /** @param {number} k @param {'root' | 'parent' | 'sibling'} kind @param {number} depth @param {string} [via] */
    const put = (k, kind, depth, via) => {
      if (self.has(k) || !isWord(k)) return
      const prev = out.get(k)
      if (!prev || depth < prev.depth || (depth === prev.depth && KIND_RANK[kind] < KIND_RANK[prev.kind])) out.set(k, { doc: k, kind, depth, ...(via ? { via } : {}) })
    }
    for (const [k, d] of down) if (d > 0) put(k, 'root', d)
    for (const [k, d] of up) put(k, 'parent', d)
    for (const [a, u] of up) {
      if (this._isAffixEntry(a)) continue
      for (const [k, d] of below([[a, 0]])) {
        if (d > 0 && !down.has(k) && !up.has(k)) put(k, 'sibling', u + d, docs.text[a])
      }
    }
    const list = [...out.values()]
    this._relations.set(t.term, list)
    return list
  }

  /**
   * 記錄是不是詞綴的條目：詞形（搜尋鍵）是語言設定檔構詞規格中的前綴、後綴、中綴或環綴的一側。
   * 詞根的條目（kita-、kawas-）也常寫成帶連字號，要靠規格區分；沒有構詞規格時一律當成詞根。
   * @param {number} k
   * @private
   */
  _isAffixEntry(k) {
    const spec = this.text.morphology?.spec
    if (!spec) return false
    if (!this._affixForms) {
      this._affixForms = new Set([
        ...spec.prefixes.map((a) => a.form),
        ...spec.suffixes.map((a) => a.form),
        ...spec.infixes.map((a) => a.form),
        ...spec.circumfixes.flatMap((c) => [c.left, c.suffix].filter(Boolean)),
      ])
    }
    return this._affixForms.has(this.text.searchKey(this.docs.text[k]))
  }

  /**
   * 例句用：辭典構詞關係中的記錄換成它們的寫法（搜尋鍵）與 posting。同一個寫法取最淺的一種。
   * @param {TermMatch} t
   * @returns {Array<{term: string, kind: 'root' | 'parent' | 'sibling', depth: number, via?: string, payloads: unknown[]}>}
   * @private
   */
  _dictionaryTokens(t) {
    /** @type {Map<string, {term: string, kind: 'root' | 'parent' | 'sibling', depth: number, via?: string, payloads: unknown[]}>} */
    const out = new Map()
    for (const r of this._dictionaryRelations(t)) {
      const term = this.text.searchKey(this.docs.text[r.doc])
      if (!term || term === t.term || term.includes(' ')) continue
      const prev = out.get(term)
      if (prev && (prev.depth < r.depth || (prev.depth === r.depth && KIND_RANK[prev.kind] <= KIND_RANK[r.kind]))) continue
      const payloads = this.index.lookup(term)
      if (payloads) out.set(term, { term, kind: r.kind, depth: r.depth, ...(r.via ? { via: r.via } : {}), payloads })
    }
    return [...out.values()]
  }

  /**
   * @param {string} key
   * @param {typeof FUZZINESS[Fuzziness]} level
   * @param {SearchResponse} response 累加走訪統計
   * @private
   */
  _fuzzyTerms(key, level, response, prepared = null) {
    const n = Array.from(key).length
    const stats = { visitedNodes: 0, prunedNodes: 0, computedRows: 0 }
    // 普通模糊搜尋與構詞搜尋的各個還原變體共用一次詞圖走訪（多通道，結果與分開搜尋相同）
    const [plain, ...morph] = this.index.searchChannels(
      [
        { query: key, options: { maxDistance: level.maxDistance(n), normalization: 'max', maxNormalized: level.maxNormalized } },
        ...(prepared?.channels ?? []),
      ],
      stats,
    )
    response.stats.visitedNodes += stats.visitedNodes
    // 與 FuzzyIndex.search 相同的排序
    plain.sort((a, b) => a.score - b.score || a.distance - b.distance || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    return { results: plain, morph }
  }

  /**
   * 一個查詢詞在詞庫中的所有命中：模糊（加權編輯距離）＋前綴＋包含。
   *
   * 為什麼需要後兩者：加權編輯距離適合「長度相近、拼寫相近」的詞，
   * 查 `pihi` 要刪掉 3 個字元才會變成 `pihilut`，遠超過門檻；單一字母 `k` 更是無從比對。
   * 前綴與包含比對用「字元 → 詞」反向索引取候選，再逐一驗證，補上這塊。
   *
   * @param {string} key 已正規化的查詢詞
   * @param {typeof FUZZINESS[Fuzziness]} level
   * @param {SearchResponse} response 累加走訪統計
   * @param {boolean} fuzzy 是否做模糊比對（中文查詢時關閉）
   * @returns {TermMatch[]}
   * @private
   */
  _matchTerms(key, level, response, fuzzy = true) {
    /** @type {Map<string, TermMatch>} */
    const matches = new Map()
    const morphology = fuzzy && this.morphSearch !== null && level.maxDistance(Array.from(key).length) > 0
    /** @type {TermMatch[]} */
    let lemma = []
    if (fuzzy) {
      const ms = morphology ? /** @type {NonNullable<typeof this.morphSearch>} */ (this.morphSearch) : null
      const prepared = ms ? ms.seed(ms.prepare(key, this._lemmaMax(key, level)) ?? null, this.index) : null
      const { results, morph } = this._fuzzyTerms(key, level, response, prepared)
      if (prepared) lemma = this._lemmaTerms(key, level, prepared, morph)
      for (const r of results) {
        matches.set(r.term, {
          term: r.term,
          payloads: r.payloads,
          distance: r.distance,
          matchType: 'fuzzy',
        })
      }
    } else {
      // 不做模糊比對時（中文查詢），完全相同的詞要另外補上：
      // 模糊搜尋本來會涵蓋距離 0 的詞，而 _substringTerms 只找「比查詢長」的詞
      const payloads = this.index.lookup(key)
      if (payloads) matches.set(key, { term: key, payloads, distance: 0, matchType: 'fuzzy' })
    }
    for (const m of this._substringTerms(key)) {
      if (!matches.has(m.term)) matches.set(m.term, m)
    }
    if (morphology) {
      // 查詢的相近寫法也當作詞根去找自動派生形：標準只用方言變體（純規則、距離不大；查 daux 也找得到 minudox），
      // 寬鬆用所有模糊命中（查 sugut 經 sungut 找到 pausunguday）
      const variants = [...matches.values()].filter((m) => m.matchType === 'fuzzy' && this._isDerivationVariant(key, level, m))
      // 同一個詞有多種命中方式時的取捨見 scoring.js 的 mergeMorphMatch：開頭相符、包含的詞能自動拆解或派生時
      // 改以構詞命中呈現、分數取較好的；與模糊命中之間取分數較好的
      for (const m of [...lemma, ...this._derivedTerms(key, variants, this._lemmaMax(key, level), lemma)]) {
        matches.set(m.term, mergeMorphMatch(m, matches.get(m.term), key))
      }
    }
    return [...matches.values()]
  }

  /**
   * 查詢的相近寫法 m 能不能也當自動派生的起點：標準只用方言變體（距離不大、全由方言規則構成；查 daux 也找得到 minudox），
   * 寬鬆用所有模糊命中（查 sugut 經 sungut 找到 pausunguday）。句型搜尋寫出詞根的構詞樣式用同一條規則（derivationSeeds）。
   * @param {string} key
   * @param {typeof FUZZINESS[Fuzziness]} level
   * @param {{term: string, distance: number}} m 模糊命中（距離 0 的是查詢本身，不算）
   */
  _isDerivationVariant(key, level, m) {
    if (m.distance <= 0) return false
    return level.derivedFromAll || (m.distance <= DIALECT_VARIANT_DISTANCE && this.explainNotes(key, m.term).every((s) => s.op === 'rule'))
  }

  /**
   * 自動派生的起點：查詢本身（在詞庫中時）與它可以當起點的相近寫法（_isDerivationVariant），附上與查詢的距離。
   * 與一般搜尋的自動派生用同一組起點；句型搜尋的 `pa-kita`、`@kita` 由這裡取得 kita 的起點。
   * @param {string} key
   * @param {Fuzziness} fuzziness
   * @returns {Array<{id: number, distance: number, term: string}>}
   */
  derivationSeeds(key, fuzziness = 'normal') {
    const level = FUZZINESS[fuzziness] ?? FUZZINESS.normal
    const scratch = /** @type {SearchResponse} */ (/** @type {unknown} */ ({ stats: { visitedNodes: 0 } }))
    const { results } = this._fuzzyTerms(key, level, scratch)
    /** @type {Array<{id: number, distance: number, term: string}>} */
    const seeds = []
    for (const s of [{ term: key, distance: 0 }, ...results.filter((m) => this._isDerivationVariant(key, level, m))]) {
      const id = this.index.dawg.lookup(s.term)
      if (id !== -1 && !seeds.some((x) => x.id === id)) seeds.push({ id, distance: s.distance, term: s.term })
    }
    return seeds
  }

  /**
   * 自動派生圖上一條路徑的分析（LemmaAnalysis）：最後一層是 stem、steps，上面幾層在 chain；
   * 起點是查詢的相近寫法時記下 variantOf（說明「由相近寫法出發」），經過虛擬詞根時記下 sibling。
   * 一般搜尋的自動派生與句型搜尋共用，兩邊的說明一致。
   * @param {string} key 查詢（或句型中寫出的詞根）
   * @param {import('./derivations.js').DerivedReach} r 路徑
   * @param {{term: string, distance: number, split?: {cost: number, steps: any[], penalty: number, lexical: boolean}}} seed 起點
   * @param {number} cost 總分（起點距離＋路徑成本，經過虛擬詞根時另加代價）
   * @param {Map<string, AlignmentNote[]>} [variantNotes] 查詢 → 起點的對齊說明（同一次搜尋共用）
   * @returns {LemmaAnalysis}
   */
  _reachAnalysis(key, r, seed, cost, variantNotes = new Map()) {
    const nodes = /** @type {DerivationGraph} */ (this.derivations).nodes
    const last = /** @type {(typeof r.path)[number]} */ (r.path.at(-1))
    /** @type {LemmaAnalysis} */
    const analysis = {
      stem: nodes[last.root],
      steps: last.analysis.steps,
      cost,
      notes: /** @type {MorphNote[]} */ (last.analysis.notes),
      ...(r.path.length > 1
        ? {
            chain: r.path.slice(0, -1).map((e) => ({ term: nodes[e.word], stem: nodes[e.root], steps: e.analysis.steps, cost: e.analysis.cost })),
          }
        : {}),
    }
    if (seed.split) {
      // 自動同根：查詢拆出的詞根就是這個詞往上的詞根（詞庫中的詞，或詞庫中沒有的虛擬詞根）
      analysis.sibling = { root: seed.term, steps: seed.split.steps, cost: seed.split.cost, penalty: seed.split.penalty, lexical: seed.split.lexical }
    } else if (seed.distance > 0) {
      analysis.variantOf = key
      analysis.variantDistance = seed.distance
      if (!variantNotes.has(seed.term)) variantNotes.set(seed.term, this.explainNotes(key, seed.term))
      analysis.variantNotes = variantNotes.get(seed.term)
    }
    return analysis
  }

  /**
   * 自動派生（查詞根、找衍生詞）：由查詢與它的相近寫法沿自動派生圖往下走（derivations.js）。
   *
   * 圖的每一條邊是建置時 BCDP 對那個詞求得的最好詞根，所以「查 r 看到 w」等於「查 w 時自動拆解最好的詞根是 r」，
   * 派生詞的派生詞也走得到。分數是起點距離加上路徑上各條邊的成本；路徑本身的成本不超過自動拆解方向的上限
   * （_lemmaMax：同一個模糊程度，兩個方向的上限相同）。
   *
   * 自動同根：先往上到查詢的詞根，再往下走（命中方式 sibling）。詞根有兩種，都以建置時同一個定義取得：
   * - 詞庫中的詞根：自動拆解最好的詞庫詞根（同分全收，比查詢短、單一個詞；與自動派生圖的邊同一個定義）。
   *   只取它的直接子詞（同一個詞根，不含孫輩），兩條邊的音變都不超過 SIBLING_MAX_SOUND：
   *   詞庫的詞根常有幾十個派生詞，兩條巧合的邊接起來尤其不可靠；
   * - 虛擬詞根：以建置時同一個函式、同樣的條件拆查詢本身（virtualRoots；詞庫中最好的詞根取自動拆解的結果），
   *   起點的距離另加詞庫外詞根的代價 virtualRootCost。
   * 查詢本身是別的詞的詞根時不往上（與虛擬詞根的條件相同：samian 不拆成 sa- ＋ mian）。
   *
   * @param {string} key
   * @param {TermMatch[]} variants 查詢的相近寫法（模糊命中的詞）
   * @param {number} maxPath 路徑成本的上限
   * @param {TermMatch[]} [lemma] 自動拆解的命中（詞庫中的詞根；虛擬詞根的條件也取它最好的成本，與建置時相同）
   * @returns {TermMatch[]}
   * @private
   */
  _derivedTerms(key, variants, maxPath, lemma = []) {
    const graph = this.derivations
    if (!graph) return []
    /** @typedef {{id: number, distance: number, term: string, split?: {cost: number, steps: any[], penalty: number, lexical: boolean}}} Seed */
    /** @type {Seed[]} */
    const seeds = []
    for (const s of [{ term: key, distance: 0 }, ...variants]) {
      const id = this.index.dawg.lookup(s.term)
      if (id !== -1) seeds.push({ id, distance: s.distance, term: s.term })
    }
    const self = this.index.dawg.lookup(key)
    const lemmaBest = Math.min(Infinity, ...lemma.map((m) => m.distance))
    /** @type {Seed[]} */
    const lexicalSeeds = []
    /** @type {Seed[]} */
    const virtualSeeds = []
    if (!isLexicalRoot(this.index, self, (id) => graph.hasChildren(id))) {
      const length = Array.from(key).length
      for (const m of lemma) {
        if (m.distance > lemmaBest + EPSILON || m.term.includes(' ') || Array.from(m.term).length >= length || !m.analysis) continue
        if (soundOf({ cost: m.distance, steps: m.analysis.steps }) > SIBLING_MAX_SOUND + EPSILON) continue
        const id = this.index.dawg.lookup(m.term)
        if (id !== -1) lexicalSeeds.push({ id, distance: m.distance, term: m.term, split: { cost: m.distance, steps: m.analysis.steps, penalty: 0, lexical: true } })
      }
      const open = /** @type {NonNullable<SearchEngine['virtualRootSearch']>} */ (this.virtualRootSearch)
      for (const v of virtualRoots(key, open, this.index, lemmaBest)) {
        const id = graph.virtualIds.get(v.stem)
        const penalty = virtualRootCost(v.stem, open.spec)
        if (id !== undefined) virtualSeeds.push({ id, distance: roundCost(v.cost + penalty), term: v.stem, split: { cost: v.cost, steps: v.steps, penalty, lexical: false } })
      }
    }
    // 分三次走，後面的只補上前面沒走到的詞：先由查詢與它的相近寫法（與沒有自動同根時完全相同），
    // 再由詞庫中的詞根，最後由虛擬詞根（把握最小）。自動同根不取代其他命中（scoring.js 的 mergeMorphMatch），在圖上也一樣
    const direct = graph.descendants(seeds, maxPath).map((r) => ({ ...r, from: seeds[r.seed] }))
    const reached = new Set(direct.map((r) => r.word))
    const viaLexical = graph
      .childrenOf(lexicalSeeds, { maxPath, maxSound: SIBLING_MAX_SOUND })
      .map((r) => ({ ...r, from: lexicalSeeds[r.seed] }))
      .filter((r) => !reached.has(r.word) && r.word !== self)
    for (const r of viaLexical) reached.add(r.word)
    const viaVirtual = virtualSeeds.length
      ? graph
          .descendants(virtualSeeds, maxPath)
          .map((r) => ({ ...r, from: virtualSeeds[r.seed] }))
          // 查詢本身也在詞庫中時不算自己；整條（拆解 ＋ 往下）也不超過同一個上限（詞庫外詞根的代價不算在內）
          .filter((r) => !reached.has(r.word) && r.word !== self && r.cost - (r.from.split?.penalty ?? 0) <= maxPath + EPSILON)
      : []
    /** @type {Map<string, AlignmentNote[]>} 查詢 → 起點的對齊說明（每個起點算一次） */
    const variantNotes = new Map()
    /** @type {TermMatch[]} */
    const out = []
    for (const r of [...direct, ...viaLexical, ...viaVirtual]) {
      const seed = r.from
      const analysis = this._reachAnalysis(key, r, seed, r.cost, variantNotes)
      out.push({
        term: this.index.terms[r.word],
        payloads: this.index.payloads[r.word],
        distance: r.cost,
        matchType: /** @type {MatchType} */ (seed.split ? 'sibling' : 'derived'),
        analysis,
      })
    }
    return out
  }

  /**
   * 含有某個字串的所有詞編號（不設上限；遞增）。候選取自 _containingCandidates，再逐一驗證。
   * @param {string} needle
   * @returns {number[]}
   * @private
   */
  _termsContaining(needle) {
    const { terms } = this._ensureTermIndex()
    return this._containingCandidates(needle).filter((id) => terms[id].includes(needle))
  }

  /**
   * 可能含有 needle 的詞編號（遞增）：needle 的每個字元與每對相鄰字元都有 posting，取最短的一個。
   * 含有 needle 的詞一定出現在每一個 posting 中，所以選哪一個都不影響驗證後的結果，只影響要驗證幾個。
   * 有字元或字元對完全沒出現過時，不可能有詞含有 needle，回傳空陣列。
   * @param {string} needle
   * @returns {number[]}
   * @private
   */
  _containingCandidates(needle) {
    const { byChar, byPair } = this._ensureTermIndex()
    const chars = Array.from(needle)
    /** @type {number[]} */
    let best = []
    for (let k = 0; k < chars.length; k++) {
      const list = byChar.get(chars[k])
      if (!list) return []
      if (k === 0 || list.length < best.length) best = list
    }
    for (let k = 1; k < chars.length; k++) {
      const list = byPair.get(chars[k - 1] + chars[k])
      if (!list) return []
      if (list.length < best.length) best = list
    }
    return best
  }

  /**
   * 自動拆解（去詞綴方向）：音變 ∘ 構詞 ∘ 詞庫的聯合搜尋 BCDP（babizu/fuzzy 的 morph-search.js）。
   *
   * 分析的成本是構詞步驟加上整個詞的音變：同一套方言規則對整個詞計算，可以跨越詞素交界
   * （ta-kita-aw → takitaw），詞首、詞尾規則與構詞音變在交界也適用（docs/bcdp.md 第 1 節）。
   * 總成本上限＝ min(1, 該模糊程度的門檻 ＋ 0.6)。精確模式不做（精確只比對拼寫相同的詞）。
   *
   * @param {string} key
   * @param {typeof FUZZINESS[Fuzziness]} level
   * @param {ReturnType<NonNullable<SearchEngine['morphSearch']>['prepare']>} prepared
   * @param {import('../fuzzy/fuzzy-index.js').SearchResult[][]} results 各通道的結果
   * @returns {TermMatch[]}
   * @private
   */
  _lemmaTerms(key, level, prepared, results) {
    if (!prepared) return []
    const search = /** @type {NonNullable<typeof this.morphSearch>} */ (this.morphSearch)
    return search.finish(prepared, results, this._lemmaMax(key, level)).map((h) => {
      /** @type {LemmaAnalysis} */
      const analysis = { stem: h.term, steps: h.steps, cost: h.distance }
      this._lazyNotes.set(analysis, () => search.notesOf(prepared, h))
      return { term: h.term, payloads: h.payloads, distance: h.distance, matchType: /** @type {MatchType} */ ('lemma'), analysis }
    })
  }

  /**
   * 前綴與包含比對。
   * @param {string} key
   * @param {number} [limit]
   * @returns {TermMatch[]}
   * @private
   */
  _substringTerms(key, limit = SUBSTRING_TERM_LIMIT) {
    if (!key) return []
    const { terms } = this._ensureTermIndex()

    // 取最少見的字元或字元對的 posting 當候選，再逐一驗證（候選的順序不影響結果：下面依長度排序）
    const candidates = this._containingCandidates(key)

    /** @type {number[]} */
    const prefix = []
    /** @type {number[]} */
    const inner = []
    for (const id of candidates) {
      const term = terms[id]
      if (term === key || !term.includes(key)) continue
      ;(term.startsWith(key) ? prefix : inner).push(id)
    }

    // 詞越短表示多出來的部分越少，越可能是使用者要找的
    const byLength = (a, b) => terms[a].length - terms[b].length || (terms[a] < terms[b] ? -1 : 1)
    prefix.sort(byLength)
    inner.sort(byLength)

    /** @type {TermMatch[]} */
    const out = []
    for (const [ids, matchType] of [
      [prefix, /** @type {MatchType} */ ('prefix')],
      [inner, /** @type {MatchType} */ ('substring')],
    ]) {
      for (const id of /** @type {number[]} */ (ids)) {
        if (out.length >= limit) return out
        out.push({
          term: terms[id],
          payloads: this.index.payloads[id],
          distance: 0,
          // 以查詢結尾的另外標示為結尾相符（排序與包含相同，只是可以分開篩選）
          matchType: matchType === 'substring' && terms[id].endsWith(key) ? 'suffix' : /** @type {MatchType} */ (matchType),
        })
      }
    }
    return out
  }

  /**
   * 「字元 → 詞編號」反向索引（第一次用到時才建立）。
   * @private
   */
  _ensureTermIndex() {
    if (this._termIndex) return this._termIndex
    const terms = this.index.terms
    /** @type {Map<string, number[]>} 字元 → 含有它的詞編號（遞增） */
    const byChar = new Map()
    /** @type {Map<string, number[]>} 相鄰的兩個字元 → 含有它的詞編號（遞增）；比單一字元的 posting 短得多 */
    const byPair = new Map()
    /** @param {Map<string, number[]>} map @param {Iterable<string>} keys @param {number} id */
    const add = (map, keys, id) => {
      for (const k of keys) {
        let list = map.get(k)
        if (!list) map.set(k, (list = []))
        list.push(id)
      }
    }
    terms.forEach((term, id) => {
      const chars = Array.from(term)
      add(byChar, new Set(chars), id)
      /** @type {Set<string>} */
      const pairs = new Set()
      for (let k = 1; k < chars.length; k++) pairs.add(chars[k - 1] + chars[k])
      add(byPair, pairs, id)
    })
    this._termIndex = { terms, byChar, byPair }
    return this._termIndex
  }

  /**
   * 中文釋義搜尋。
   * @param {string} q
   * @param {(k: number) => boolean} accept
   * @returns {GlossHit[]}
   * @private
   */
  _searchZh(q, accept) {
    const needle = zhNormalize(q)
    if (!needle) return []
    const index = this._ensureZhIndex()

    // 取所有漢字 posting 的交集，從最短的開始
    const chars = [...new Set(Array.from(needle).filter((ch) => /\p{Script=Han}/u.test(ch)))]
    const lists = chars.map((ch) => index.get(ch) ?? [])
    lists.sort((a, b) => a.length - b.length)
    let candidates = lists.length > 0 ? lists[0] : this.docs.zh.map((_, k) => k)
    for (const list of lists.slice(1)) {
      const set = new Set(list)
      candidates = candidates.filter((k) => set.has(k))
      if (candidates.length === 0) break
    }

    /** @type {GlossHit[]} */
    const hits = []
    for (const k of candidates) {
      if (!accept(k)) continue
      const zh = zhNormalize(this.docs.zh[k])
      if (!zh.includes(needle)) continue
      hits.push({ doc: this.doc(k), field: 'zh', rank: glossRank(zh.split(/[；;，,、]/u), needle) })
    }
    return sortGlossHits(hits)
  }

  /**
   * 英文與臺語羅馬字釋義搜尋：每個查詢詞都要命中（整詞，或長度 ≥ 3 時的詞首）。
   * @param {string} q
   * @param {(k: number) => boolean} accept
   * @returns {GlossHit[]}
   * @private
   */
  _searchLatinGloss(q, accept) {
    // 去掉英文虛詞；全部都是虛詞（例如單查 a）時不搜尋釋義，避免列出上千筆無意義結果
    const queryTokens = glossTokens(q).filter((t) => !GLOSS_STOPWORDS.has(t))
    if (queryTokens.length === 0) return []
    const { tokens, sorted } = this._ensureGlossIndex()

    /** @type {Map<number, 'en' | 'nan'> | null} */
    let combined = null
    for (const qt of queryTokens) {
      /** @type {Map<number, 'en' | 'nan'>} */
      const found = new Map()
      const matching = Array.from(qt).length >= 3 ? prefixRange(sorted, qt) : tokens.has(qt) ? [qt] : []
      for (const token of matching) {
        for (const [k, field] of tokens.get(token) ?? []) {
          if (!found.has(k) || field === 'en') found.set(k, field)
        }
      }
      if (combined === null) combined = found
      else {
        const next = new Map()
        for (const [k, field] of combined) if (found.has(k)) next.set(k, field)
        combined = next
      }
      if (combined.size === 0) break
    }

    const phrase = queryTokens.join(' ')
    /** @type {GlossHit[]} */
    const hits = []
    for (const [k, field] of combined ?? new Map()) {
      if (!accept(k)) continue
      const text = this.docs[field][k]
      const senses = text.split(/[;；]/u).map((s) => glossTokens(s).join(' '))
      hits.push({ doc: this.doc(k), field, rank: glossRank(senses, phrase, true) })
    }
    return sortGlossHits(hits)
  }

  /** @private */
  _ensureZhIndex() {
    if (this._zhIndex) return this._zhIndex
    /** @type {Map<string, number[]>} */
    const index = new Map()
    this.docs.zh.forEach((zh, k) => {
      for (const ch of new Set(Array.from(zh))) {
        if (!/\p{Script=Han}/u.test(ch)) continue
        let list = index.get(ch)
        if (!list) index.set(ch, (list = []))
        list.push(k)
      }
    })
    this._zhIndex = index
    return index
  }

  /** @private */
  _ensureGlossIndex() {
    if (this._glossIndex) return this._glossIndex
    /** @type {Map<string, Array<[number, 'en' | 'nan']>>} */
    const tokens = new Map()
    for (const field of /** @type {const} */ (['en', 'nan'])) {
      this.docs[field].forEach((text, k) => {
        for (const token of glossTokens(text)) {
          let list = tokens.get(token)
          if (!list) tokens.set(token, (list = []))
          list.push([k, field])
        }
      })
    }
    this._glossIndex = { tokens, sorted: [...tokens.keys()].sort() }
    return this._glossIndex
  }

  /**
   * @param {SearchFilters} filters
   * @returns {(k: number) => boolean}
   * @private
   */
  _createFilter({ sources, dialects, units, statuses } = {}) {
    const docs = this.docs
    const sourceSet = sources?.length ? new Set(sources.map((s) => docs.sources.indexOf(s))) : null
    const unitSet = units?.length ? new Set(units.map((u) => docs.units.indexOf(u))) : null
    const statusSet = statuses?.length ? new Set(statuses.map((s) => docs.statuses.indexOf(s))) : null
    let dialectMask = 0
    let allowNone = false
    for (const d of dialects ?? []) {
      if (d === 'none') allowNone = true
      // 勾一個變體，連它包含的下層變體一起納入（例如巴宰 ⊇ 愛蘭；包含關係來自站台設定）
      for (const code of docs.dialectSupersets?.[d] ?? [d]) {
        const bit = docs.dialects.indexOf(code)
        if (bit >= 0) dialectMask |= 1 << bit
      }
    }
    const filterDialects = (dialects?.length ?? 0) > 0

    return (k) => {
      if (sourceSet && !sourceSet.has(docs.source[k])) return false
      if (unitSet && !unitSet.has(docs.unit[k])) return false
      if (statusSet && !statusSet.has(docs.status[k])) return false
      if (filterDialects) {
        const mask = docs.dialect[k]
        if (!((mask & dialectMask) !== 0 || (allowNone && mask === 0))) return false
      }
      return true
    }
  }
}

/**
 * 哪些 posting 可以跟哪種命中方式搭配：
 * - 自動拆解（lemma）：詞根本身，以及辭典標註的派生詞（root posting，排在詞根之後）。
 *   查 kinawas 得到詞根 kawas 時，mukawas、maakawas 等已標註的派生詞也要列出來
 * - 自動派生（derived）、自動同根（sibling）：不沿用 root posting，那是「派生詞的派生詞」
 * - 其他（完全相符、相近拼寫、開頭相符、結尾相符、包含）：沿用，關係是確定派生（fuzzy）或以把握較小的那一種計（scoring.js 的 methodOf）
 * @param {MatchType} matchType
 * @param {import('./format.js').MatchKind} kind
 */
function usablePosting(matchType, kind) {
  if (matchType === 'derived' || matchType === 'sibling') return kind !== 'root'
  return true
}

/** @param {EntryHit[]} hits */
function sortEntries(hits) {
  return hits.sort(compareHits)
}

/** @param {GlossHit[]} hits */
function sortGlossHits(hits) {
  return hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      (ROLE_RANK[a.doc.role] ?? 9) - (ROLE_RANK[b.doc.role] ?? 9) ||
      a.doc[a.field].length - b.doc[b.field].length ||
      a.doc.index - b.doc.index,
  )
}

/**
 * 釋義命中等級：0 某義項完全相同、1 某義項以查詢開頭（英文另接受 "to " 開頭）、2 整詞包含、3 其他。
 * @param {string[]} senses 已正規化的各義項
 * @param {string} needle 已正規化的查詢
 * @param {boolean} [latin] 是否以空白分詞比對
 */
function glossRank(senses, needle, latin = false) {
  const trimmed = senses.map((s) => s.trim())
  if (trimmed.some((s) => s === needle || (latin && s === `to ${needle}`))) return 0
  if (trimmed.some((s) => s.startsWith(needle) || (latin && s.startsWith(`to ${needle}`)))) return 1
  if (latin && trimmed.some((s) => ` ${s} `.includes(` ${needle} `))) return 2
  return 3
}

/**
 * 在排序過的詞表中找出所有以 prefix 開頭的詞（二分搜尋）。
 * @param {string[]} sorted
 * @param {string} prefix
 */
function prefixRange(sorted, prefix) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < prefix) lo = mid + 1
    else hi = mid
  }
  const out = []
  for (let k = lo; k < sorted.length && sorted[k].startsWith(prefix); k++) out.push(sorted[k])
  return out
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
