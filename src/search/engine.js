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

import { createChartSearch, createMorphSearch, FuzzyIndex } from '../fuzzy/index.js'
import { buildEntryGroups, collectHits } from './family.js'
import { decodePosting, docAt, INDEX_FORMAT_VERSION } from './format.js'
import { createTextTools, detectQueryMode, glossTokens, zhNormalize } from './text.js'

/**
 * 模糊程度：依查詢長度 n（code point）決定距離門檻。
 * normalization 一律用 'max'（距離 ÷ 較長字串長度），避免短查詢配到長詞。
 */
export const FUZZINESS = Object.freeze({
  exact: { label: '精確', maxDistance: () => 0, maxNormalized: Infinity },
  normal: { label: '標準', maxDistance: (n) => clamp(0.2 + 0.15 * n, 0.3, 1.6), maxNormalized: 0.3 },
  loose: { label: '寬鬆', maxDistance: (n) => clamp(0.5 + 0.25 * n, 0.8, 3), maxNormalized: 0.5 },
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
 * @property {MorphMethod} [morphMethod='bcdp'] 構詞搜尋（詞根方向）的實作；兩者的成本相同，結果只在同分時的說明可能不同
 */

/**
 * 構詞搜尋的實作（babizu docs/morph-grammar.md 第 5 節）：
 * - bcdp：編譯後的邊界耦合 DP，與模糊搜尋共用一次詞圖走訪（預設，較快）
 * - chart：類 pika 的加權剖析器，由文法直接計算（另外走訪詞圖；做為對照與 benchmark）
 * @typedef {'bcdp' | 'chart'} MorphMethod
 */

/** @type {readonly MorphMethod[]} */
export const MORPH_METHODS = Object.freeze(['bcdp', 'chart'])

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
 * @property {number} score 排序用的等效距離（見 rankScore）
 * @property {MatchType} matchType 以哪一種方式命中
 * @property {import('./format.js').MatchKind} kind
 * @property {AlignmentNote[] | null} alignment
 * @property {LemmaAnalysis | null} [analysis] 構詞分析：詞根相符（matchType 'lemma'）時是查詢的分析，
 *   衍生形（matchType 'derived'）時是命中詞的分析
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
 * @property {string} [variantOf] 衍生形方向以查詢的方言變體當詞根時，查詢本身
 * @property {number} [variantDistance] 查詢 → 方言變體的距離
 * @property {number} [penalty] 不成立的同位詞素條件的懲罰（構詞文法；沒有時省略）
 * @property {Array<{id: string, form: string, when: string, penalty: number}>} [violations] 不成立的條件（有 penalty 時才有）
 * @property {MorphNote[] | null} [notes] 整個詞的音變說明（只為前幾筆結果計算）；
 *   衍生形方向用了方言變體時，查詢 → 變體的音變也在內（where 為 stem）
 */

/** @typedef {'fuzzy' | 'prefix' | 'lemma' | 'derived' | 'substring'} MatchType */

/**
 * @typedef {object} TermMatch 一個查詢詞在詞庫中的命中
 * @property {string} term
 * @property {unknown[]} payloads
 * @property {number} distance
 * @property {MatchType} matchType
 * @property {LemmaAnalysis} [analysis] 構詞命中（lemma、derived）的分析
 */

/**
 * @typedef {object} OccurrenceHit 例句命中
 * @property {import('./format.js').DocSummary} doc
 * @property {string[]} terms 句中命中的詞（搜尋鍵），供前端高亮
 * @property {number} distance 各查詢詞距離總和
 * @property {number} score 排序用的等效距離總和
 * @property {MatchType} matchType 各查詢詞中最弱的命中方式
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
 * @property {{elapsedMs: number, visitedNodes: number, morphMethod: MorphMethod | null}} stats morphMethod：這次構詞搜尋用的實作（沒有構詞規格時為 null）
 */

const KIND_RANK = { head: 0, alt: 1, variant: 2, root: 3, token: 4 }

/**
 * 命中方式：
 * - fuzzy：加權編輯距離在門檻內（含完全相同、跨方言變體）
 * - prefix：詞庫中的詞以查詢開頭（查 pihi → pihilut）
 * - lemma：查詢去詞綴後的詞幹命中詞庫的詞（查 mudaux → daux）
 * - derived：詞庫的詞去詞綴後正好是查詢（查 baket → binaket、mubaket）
 * - substring：詞庫中的詞包含查詢（查 k → 所有含 k 的詞與句子）
 * lemma 與 derived 只在語言設定檔有 `morphology` 時出現。
 */
const MATCH_TYPES = /** @type {const} */ (['fuzzy', 'prefix', 'lemma', 'derived', 'substring'])
const MATCH_TYPE_RANK = { fuzzy: 0, prefix: 1, lemma: 2, derived: 3, substring: 4 }

/**
 * 構詞相關命中的基本等效距離：一層詞綴（成本 0.3）約 0.7，
 * 排在完全相同、跨方言變體與短的前綴命中之後，包含命中之前。
 */
const MORPHOLOGY_BASE_SCORE = 0.4

/** 詞根相符時，辭典標註的派生詞（root posting）排在詞根本身之後 */
const LEMMA_DERIVATIVE_PENALTY = 0.1

/** 構詞搜尋的總成本上限：min(LEMMA_MAX_DISTANCE, 模糊程度門檻 ＋ LEMMA_EXTRA_DISTANCE) */
const LEMMA_MAX_DISTANCE = 1
const LEMMA_EXTRA_DISTANCE = 0.6

/** 查詢的方言變體也拿來找衍生形：只取距離這麼小、且全由方言規則構成的模糊命中 */
const DIALECT_VARIANT_DISTANCE = 0.3

/**
 * 衍生形方向（查詞根、找衍生詞）允許的音變：詞典中的衍生詞是標準寫法，音變只來自詞素交界
 * （喉塞音增生、元音合併、構詞音變），一兩條規則的成本就夠
 */
const DERIVED_SOUND_DISTANCE = 0.2
/** 衍生形方向跨查詢保留的編譯結果個數（每個詞兩份，約數 KB） */
const PLAN_CACHE_LIMIT = 4096

/**
 * 把前綴／包含命中換算成「等效距離」，好跟模糊命中一起排序。
 *
 * 分數的意義：完全相同 0、跨方言變體 0.1–0.3、前綴命中約 0.35 起、包含命中約 0.9 起，
 * 多出來的字元越多分數越高。這樣「查 pihi 找 pihilut」會排在「拼錯一個字母的 pihik-（0.8）」之前，
 * 而精確與跨方言命中仍然穩居最前面。
 *
 * @param {MatchType} matchType
 * @param {number} distance 模糊命中的距離
 * @param {number} extraLength 詞比查詢多出來的字元數
 */
function rankScore(matchType, distance, extraLength) {
  if (matchType === 'fuzzy') return distance
  if (matchType === 'lemma' || matchType === 'derived') return MORPHOLOGY_BASE_SCORE + distance
  const base = matchType === 'prefix' ? 0.35 : 0.9
  return base + Math.min(extraLength, 12) * 0.05
}

/**
 * 構詞命中 m 是否比同一個詞原有的命中 prev 好（見 _matchTerms）。
 * @param {TermMatch} m 構詞命中（lemma 或 derived）
 * @param {TermMatch} prev
 * @param {string} key 查詢詞
 */
function isBetterMatch(m, prev, key) {
  const extra = Math.max(0, m.term.length - key.length)
  const a = rankScore(m.matchType, m.distance, extra)
  const b = rankScore(prev.matchType, prev.distance, extra)
  // 分數是幾個小數相加（0.4 ＋ 0.2），比較時容許浮點誤差，免得同分被當成不同分
  if (Math.abs(a - b) > 1e-9) return a < b
  return prev.matchType === 'prefix' || prev.matchType === 'substring'
}

/** 前綴／包含比對每個查詢詞最多取幾個詞，避免單字母查詢產生過多結果 */
const SUBSTRING_TERM_LIMIT = 300

/** 英文釋義搜尋忽略的虛詞 */
const GLOSS_STOPWORDS = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'is', 'be', 'and', 'or', 'for', 'with'])
const ROLE_RANK = { head: 0, item: 0, form: 1, segment: 2, example: 3, '': 4 }

export class SearchEngine {
  /**
   * @param {{
   *   docs: import('./format.js').SearchDocs,
   *   lexicon: import('../fuzzy/fuzzy-index.js').SerializedIndex,
   *   profile: import('../fuzzy/profile.js').LanguageProfile,
   * }} data `profile` 必須是建索引時用的同一份語言設定檔（建置輸出的 search/language.json）
   */
  constructor({ docs, lexicon, profile }) {
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
    /** @type {ReturnType<typeof createChartSearch> | null} 類 pika 剖析器（第一次用 morphMethod: 'chart' 時才建立） */
    this._chart = null
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
    /**
     * 衍生形方向：候選詞 → 它的聯合對齊編譯結果（依詞綴、詞幹兩種段落）。同一個詞會被不同的詞根、
     * 同一個查詢的不同詞、不同的查詢反覆驗證，編譯只看這個詞，所以跨查詢保留最近用過的 PLAN_CACHE_LIMIT 個
     * @type {Map<string, Map<string, any>>}
     */
    this._derivedPlans = new Map()
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
   * 清掉跨查詢的快取（構詞分析的備忘、詞綴掃描），不影響結果。量測「沒有快取」的耗時時用。
   */
  clearCaches() {
    this.text.morphology?.clearCache()
    this.morphSearch?.clearCache()
    this._derivedPlans.clear()
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
      morphMethod = 'bcdp',
    } = options
    if (!MORPH_METHODS.includes(morphMethod)) throw new RangeError(`未知的構詞搜尋方法「${morphMethod}」（${MORPH_METHODS.join('、')}）`)
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
      stats: { elapsedMs: 0, visitedNodes: 0, morphMethod: this.morphSearch ? morphMethod : null },
    }
    if (!q) return response

    const accept = this._createFilter(filters)
    if (searchNative) {
      // 中文查詢對族語欄位只做「包含」比對：族語欄位中可能夾雜中文註記（形如「族語詞 中文詞」），
      // 但加權編輯距離對中文沒有意義
      this._searchNative(q, FUZZINESS[fuzziness] ?? FUZZINESS.normal, accept, response, explainLimit, {
        fuzzy: mode === 'latin',
        morphMethod,
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
    response.entries = response.entries.slice(0, limit)
    response.entryGroups = response.entryGroups.slice(0, limit)
    response.occurrences = response.occurrences.slice(0, limit)
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
   * @param {{fuzzy?: boolean, morphMethod?: MorphMethod}} [mode] fuzzy=false 時只做前綴／包含比對
   * @private
   */
  _searchNative(q, level, accept, response, explainLimit, { fuzzy = true, morphMethod = 'bcdp' } = {}) {
    const key = this.text.searchKey(q)
    if (!key) return
    const words = this.text.splitWords(q)

    const fullTerms = this._matchTerms(key, level, response, fuzzy, morphMethod)
    response.terms = fullTerms
      .filter((t) => t.matchType === 'fuzzy')
      .slice(0, 30)
      .map(({ term, distance }) => ({ term, distance }))

    // 詞條：整個查詢對應詞庫詞
    /** @type {Map<number, EntryHit>} */
    const entries = new Map()
    for (const t of fullTerms) {
      for (const code of /** @type {number[]} */ (t.payloads)) {
        const { doc: k, kind } = decodePosting(code)
        if (kind === 'token' || !accept(k) || !usablePosting(t.matchType, kind)) continue
        const prev = entries.get(k)
        /** @type {EntryHit} */
        const hit = {
          doc: prev?.doc ?? this.doc(k),
          term: t.term,
          distance: t.distance,
          score:
            rankScore(t.matchType, t.distance, Math.max(0, t.term.length - key.length)) +
            (t.matchType === 'lemma' && kind === 'root' ? LEMMA_DERIVATIVE_PENALTY : 0),
          matchType: t.matchType,
          kind,
          alignment: null,
          analysis: t.analysis ?? null,
        }
        if (!prev || compareHits(hit, prev) < 0) entries.set(k, hit)
      }
    }
    response.entries = sortEntries([...entries.values()])
    // 詞條家族：辭典確認屬於同一個詞條的命中排在一起，詞根條目在最上面（family.js）
    response.entryGroups = buildEntryGroups(response.entries, {
      parent: this.docs.parent,
      children: (k) => this._childrenOf(k),
      doc: (k) => this.doc(k),
      key: (text) => this.text.searchKey(text),
      compareHits,
    })
    // 對齊與構詞說明只為前幾筆計算：分數最好的幾筆，以及畫面上依家族排列時的前幾列
    /** @param {EntryHit} hit */
    const explain = (hit) => {
      if (hit.matchType === 'fuzzy' && hit.distance > 0 && hit.alignment === null) hit.alignment = this.explainNotes(key, hit.term)
      const a = hit.analysis
      if (a && a.notes === undefined) a.notes = this._lazyNotes.get(a)?.() ?? null
    }
    for (const hit of response.entries.slice(0, explainLimit)) explain(hit)
    let shown = 0
    for (const group of response.entryGroups) {
      for (const hit of collectHits(group.root)) {
        if (shown++ >= explainLimit) break
        explain(hit)
      }
      if (shown >= explainLimit) break
    }

    // 例句：每個查詢詞都要在句中出現（模糊），距離相加排序。
    // 重複的查詢詞（例如 ma sa kau ma ngit 的 ma）只算一次，走訪統計照樣累加，與逐次計算相同
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
      const terms = this._matchTerms(word, level, response, fuzzy, morphMethod)
      seen.set(word, { terms, visited: response.stats.visitedNodes - before })
      return terms
    }
    /** @type {Map<number, {distance: number, score: number, rank: number, terms: string[]}> | null} */
    let combined = null
    for (const word of words.length > 0 ? words : [key]) {
      const terms = matchWord(word)
      /** @type {Map<number, {distance: number, score: number, rank: number, terms: string[]}>} */
      const found = new Map()
      for (const t of terms) {
        const rank = MATCH_TYPE_RANK[t.matchType]
        const score = rankScore(t.matchType, t.distance, Math.max(0, t.term.length - word.length))
        for (const code of /** @type {number[]} */ (t.payloads)) {
          const { doc: k, kind } = decodePosting(code)
          if (kind !== 'token' || !accept(k)) continue
          const prev = found.get(k)
          if (!prev) found.set(k, { distance: t.distance, score, rank, terms: [t.term] })
          else {
            prev.terms.push(t.term)
            // 同一句可能同時被多種方式命中，取最好的一種
            if (score < prev.score) {
              prev.rank = rank
              prev.score = score
              prev.distance = t.distance
            }
          }
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
            })
          }
        }
        combined = next
      }
      if (combined.size === 0) break
    }

    response.occurrences = [...(combined ?? new Map())]
      .filter(([k]) => !entries.has(k))
      .map(([k, v]) => ({
        doc: this.doc(k),
        terms: [...new Set(v.terms)],
        distance: Math.round(v.distance * 1e9) / 1e9,
        score: v.score,
        matchType: /** @type {MatchType} */ (MATCH_TYPES[v.rank]),
      }))
      .sort(
        (a, b) =>
          a.score - b.score ||
          a.distance - b.distance ||
          a.doc.text.length - b.doc.text.length ||
          a.doc.index - b.doc.index,
      )
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
   * @param {MorphMethod} [morphMethod] 構詞搜尋（詞根方向）的實作
   * @returns {TermMatch[]}
   * @private
   */
  _matchTerms(key, level, response, fuzzy = true, morphMethod = 'bcdp') {
    /** @type {Map<string, TermMatch>} */
    const matches = new Map()
    const morphology = fuzzy && this.morphSearch !== null && level.maxDistance(Array.from(key).length) > 0
    /** @type {TermMatch[]} */
    let lemma = []
    if (fuzzy) {
      // BCDP 與模糊搜尋共用一次詞圖走訪；類 pika 剖析器另外算（morphMethod: 'chart'）
      const ms = morphology && morphMethod === 'bcdp' ? /** @type {NonNullable<typeof this.morphSearch>} */ (this.morphSearch) : null
      const prepared = ms ? ms.seed(ms.prepare(key, this._lemmaMax(key, level)) ?? null, this.index) : null
      const { results, morph } = this._fuzzyTerms(key, level, response, prepared)
      if (prepared) lemma = this._lemmaTerms(key, level, prepared, morph)
      else if (morphology && morphMethod === 'chart') lemma = this._chartLemmaTerms(key, level, response)
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
      // 查詢的方言變體（純規則、距離不大）也當作詞幹去找衍生形：查 daux 也找得到 minudox
      const variants = [...matches.values()]
        .filter((m) => m.matchType === 'fuzzy' && m.distance > 0 && m.distance <= DIALECT_VARIANT_DISTANCE)
        .filter((m) => this.explainNotes(key, m.term).every((s) => s.op === 'rule'))
      // 同一個詞有多種命中方式時，取排序分數（rankScore，與詞條排序用的是同一個）較好的一種。
      // 不能只看命中方式：詞根落在模糊門檻內時（查 parazem，razem 的模糊距離 1.2 在門檻 1.25 內），
      // 最好的構詞分析（pa- ＋ razem，0.2）會被較差的模糊命中蓋掉。同分時模糊命中優先（直接相符），
      // 構詞命中優先於前綴、包含（說明比較有用）
      for (const m of [...lemma, ...this._derivedTerms(key, variants)]) {
        const prev = matches.get(m.term)
        if (!prev || isBetterMatch(m, prev, key)) matches.set(m.term, m)
      }
    }
    return [...matches.values()]
  }

  /**
   * 衍生形（還原詞綴方向）：詞庫中分析得出詞幹正好是查詢的詞，包括語料句子裡的詞。
   *
   * 與詞根相符是同一個模型：分析的成本是構詞步驟加上整個詞的音變（規則可以跨越詞素交界）。
   * 候選先用「字元 → 詞」索引找含有詞根核心形式的詞，再列出「前綴鏈 · 核心形式 · 後綴鏈」的結構
   * （詞綴原樣、交界上容許一個字元的出入，morphology.derivations），逐一以整個詞的聯合對齊
   * （metric.jointDistance）驗證。衍生詞是標準寫法，整個詞的音變不能超過 DERIVED_SOUND_DISTANCE
   * （docs/bcdp.md 第 10 節）。
   *
   * 查詢的方言變體（variants：純規則、距離小的模糊命中詞）也各當一次詞根，
   * 成本加上變體本身的距離，說明中附上查詢 → 變體的音變。
   *
   * @param {string} key
   * @param {TermMatch[]} [variants]
   * @returns {TermMatch[]}
   * @private
   */
  _derivedTerms(key, variants = []) {
    const morphology = /** @type {import('../fuzzy/morphology.js').Analyzer} */ (this.text.morphology)
    const search = /** @type {NonNullable<typeof this.morphSearch>} */ (this.morphSearch)
    const { terms } = this._ensureTermIndex()
    /** @type {Map<string, TermMatch>} */
    const out = new Map()
    const plansOf = this._derivedPlans
    for (const { term: stem, distance: offset } of [{ term: key, distance: 0 }, ...variants]) {
      if (Array.from(stem).length < morphology.spec.minStem) continue
      const seen = new Set()
      const cores = morphology.coreForms(stem)
      for (const core of cores) {
        for (const id of this._termsContaining(core)) {
          const term = terms[id]
          if (term === key || term === stem || seen.has(term)) continue
          seen.add(term)
          // 候選分析的結構（詞綴原樣、交界上容許一個字元的出入），逐一以整個詞的聯合對齊驗證
          const x = Array.from(term)
          let plans = plansOf.get(term)
          if (plans) plansOf.delete(term)
          else plans = new Map()
          plansOf.set(term, plans)
          if (plansOf.size > PLAN_CACHE_LIMIT) plansOf.delete(/** @type {string} */ (plansOf.keys().next().value))
          /** @type {{cost: number, steps: import('../fuzzy/morph-search.js').MorphStepHit[], segments: any[], penalty: number, violations: any[]} | null} */
          let best = null
          for (const d of morphology.derivations(term, stem)) {
            const circ = d.circumfix
            /** @param {'prefix' | 'suffix'} type @param {string} form */
            const affix = (type, form) => ({ chars: Array.from(form), lock: true, type })
            // 環綴緊貼詞幹：前綴式的左邊是最內層的前綴，後綴是最內層的後綴（中綴、重疊式的左邊已在詞幹段裡）
            const segments = [
              ...d.prefixes.map((a) => affix('prefix', a.form)),
              ...(circ?.left?.type === 'prefix' ? [affix('prefix', circ.left.form)] : []),
              { chars: Array.from(d.segment), lock: false, type: /** @type {const} */ ('stem') },
              ...(circ?.suffix ? [affix('suffix', circ.suffix)] : []),
              ...[...d.suffixes].reverse().map((a) => affix('suffix', a.form)),
            ]
            const sound = this.metric.jointDistance(x, segments, DERIVED_SOUND_DISTANCE, plans)
            if (sound > DERIVED_SOUND_DISTANCE + 1e-9) continue
            /** @param {'prefix' | 'suffix'} type @param {any} a */
            const stepOf = (type, a) => ({ type, form: a.form, gloss: a.gloss, cost: a.cost, ...(a.parts ? { parts: a.parts } : {}) })
            /** @type {import('../fuzzy/morph-search.js').MorphStepHit[]} */
            const steps = [
              ...d.prefixes.map((a) => stepOf('prefix', a)),
              ...(d.op ? [/** @type {any} */ (d.op)] : []),
              ...(circ ? [/** @type {any} */ (circ)] : []),
              ...d.suffixes.map((a) => stepOf('suffix', a)),
            ]
            // 同位詞素條件的懲罰（構詞文法）：條件讀的是底層，也就是詞根 stem 與詞綴
            const { total: penalty, violations } = search.penaltyOf(
              {
                prefixes: /** @type {any} */ (d.prefixes),
                suffixes: /** @type {any} */ (d.suffixes),
                circumfix: circ ? /** @type {any} */ ({ kind: circ.left?.type, left: circ.left?.form ?? '', suffix: circ.suffix ?? '', checks: /** @type {any} */ (d).circChecks }) : null,
                opChecks: /** @type {any} */ (d).opChecks ?? null,
              },
              stem,
            )
            const cost = steps.reduce((sum, st) => sum + st.cost, 0) + sound + penalty
            if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) <= 1e-9 && steps.length < best.steps.length)) best = { cost, steps, segments, penalty, violations }
          }
          if (!best) continue
          const distance = Math.round((best.cost + offset) * 1e9) / 1e9
          const prev = out.get(term)
          if (prev && prev.distance <= distance) continue
          /** @type {LemmaAnalysis} */
          const analysis = { stem, steps: best.steps, cost: distance, ...(offset > 0 ? { variantOf: key, variantDistance: offset } : {}), ...(best.penalty > 0 ? { penalty: Math.round(best.penalty * 1e9) / 1e9, violations: best.violations } : {}) }
          const segments = best.segments
          this._lazyNotes.set(analysis, () => [
            ...(offset > 0 ? this.explainNotes(key, stem).map((n) => ({ ...n, where: /** @type {const} */ ('stem') })) : []),
            ...search.notesFor(x, segments),
          ])
          out.set(term, { term, payloads: this.index.payloads[id], distance, matchType: 'derived', analysis })
        }
      }
    }
    return [...out.values()]
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
   * 詞根相符（去詞綴方向）：音變 ∘ 構詞 ∘ 詞庫的聯合搜尋 BCDP（babizu/fuzzy 的 morph-search.js）。
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
      const analysis = { stem: h.term, steps: h.steps, cost: h.distance, ...(h.penalty ? { penalty: h.penalty, violations: h.violations } : {}) }
      this._lazyNotes.set(analysis, () => search.notesOf(prepared, h))
      return { term: h.term, payloads: h.payloads, distance: h.distance, matchType: /** @type {MatchType} */ ('lemma'), analysis }
    })
  }

  /**
   * 詞根相符（類 pika 剖析器，morphMethod: 'chart'）：與 _lemmaTerms 相同的格式與成本（兩種實作互相仲裁，
   * babizu test/fuzzy/grammar/chart.test.js）。音變說明由命中的 trace 以整個詞的聯合對齊重建（需要時才算）。
   * @param {string} key
   * @param {typeof FUZZINESS[Fuzziness]} level
   * @param {SearchResponse} response 累加走訪統計
   * @returns {TermMatch[]}
   * @private
   */
  _chartLemmaTerms(key, level, response) {
    const search = /** @type {NonNullable<typeof this.morphSearch>} */ (this.morphSearch)
    const analyzer = /** @type {import('../fuzzy/morphology.js').Analyzer} */ (this.text.morphology)
    this._chart ??= createChartSearch({ grammar: analyzer.grammar, metric: this.metric, index: this.index })
    const stats = { visitedNodes: 0, columns: 0 }
    const hits = this._chart.search(key, { maxDistance: this._lemmaMax(key, level), stats })
    response.stats.visitedNodes += stats.visitedNodes
    return hits.map((h) => {
      /** @type {LemmaAnalysis} */
      const analysis = { stem: h.term, steps: /** @type {any} */ (h.steps), cost: h.distance, ...(h.penalty ? { penalty: h.penalty, violations: h.violations } : {}) }
      this._lazyNotes.set(analysis, () => search.notesFor(h.trace.query, h.trace.segments, h.trace.options))
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
          matchType: /** @type {MatchType} */ (matchType),
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
 * - 詞根相符（lemma）：詞根本身，以及辭典標註的派生詞（root posting，排在詞根之後）。
 *   查 kinawas 得到詞根 kawas 時，mukawas、maakawas 等已標註的派生詞也要列出來
 * - 衍生形（derived）：不沿用 root posting，那是「衍生詞的衍生詞」
 * @param {MatchType} matchType
 * @param {import('./format.js').MatchKind} kind
 */
function usablePosting(matchType, kind) {
  if (matchType === 'derived') return kind !== 'root'
  return true
}

/**
 * 詞條命中的排序：先分組（模糊 → 前綴 → 包含），組內再比距離、命中身分、角色、長度。
 * @param {EntryHit} a
 * @param {EntryHit} b
 */
function compareHits(a, b) {
  return (
    a.score - b.score ||
    MATCH_TYPE_RANK[a.matchType] - MATCH_TYPE_RANK[b.matchType] ||
    a.term.length - b.term.length ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    (ROLE_RANK[a.doc.role] ?? 9) - (ROLE_RANK[b.doc.role] ?? 9) ||
    a.doc.text.length - b.doc.text.length ||
    a.doc.index - b.doc.index
  )
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
