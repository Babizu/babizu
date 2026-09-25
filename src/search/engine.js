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

import { createMorphSearch, FuzzyIndex } from '../fuzzy/index.js'
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
 * @property {number} score 排序用的等效距離（見 rankScore）
 * @property {MatchType} matchType 以哪一種方式命中
 * @property {import('./format.js').MatchKind} kind
 * @property {AlignmentNote[] | null} alignment
 * @property {LemmaAnalysis | null} [analysis] 構詞分析：詞根相符（matchType 'lemma'）時是查詢的分析，
 *   衍生形（matchType 'derived'）時是命中詞的分析
 */

/**
 * @typedef {object} LemmaAnalysis
 * @property {string} stem 詞幹（詞庫中的寫法）
 * @property {Array<import('../fuzzy/morph-search.js').MorphStepHit>} steps 由外而內的構詞步驟
 *   （詞綴本身有音變時，step.surface 是查詢中的寫法）
 * @property {number} cost 總成本（構詞步驟＋詞綴音變＋詞幹音變）
 * @property {string} [stemSurface] 詞根相符時，查詢中對應詞幹的那一段（與 stem 不同表示詞幹有音變）
 * @property {number} [stemDistance] 詞幹部分的加權編輯距離
 * @property {AlignmentNote[] | null} [stemAlignment] 詞幹音變的對齊說明（只為前幾筆結果計算）
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
 * @property {EntryHit[]} entries
 * @property {OccurrenceHit[]} occurrences
 * @property {GlossHit[]} glosses
 * @property {{entries: number, occurrences: number, glosses: number}} totals 截斷前的總數
 * @property {{elapsedMs: number, visitedNodes: number}} stats
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
    /** @type {Map<string, number> | null} */
    this._idIndex = null
    /** @type {Map<string, number[]> | null} */
    this._zhIndex = null
    /** @type {{tokens: Map<string, Array<[number, 'en' | 'nan']>>, sorted: string[]} | null} */
    this._glossIndex = null
    /** @type {{terms: string[], byChar: Map<string, number[]>, byPair: Map<string, number[]>} | null} */
    this._termIndex = null
    /** @type {{key: string, indices: number[]} | null} */
    this._listCache = null
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
    const maxDistance = Math.min(LEMMA_MAX_DISTANCE, level.maxDistance(Array.from(key).length) + LEMMA_EXTRA_DISTANCE)
    return this.morphSearch.explain(key, term === null ? null : this.text.searchKey(term), { maxDistance })
  }

  /**
   * 清掉跨查詢的快取（構詞分析的備忘、詞綴掃描），不影響結果。量測「沒有快取」的耗時時用。
   */
  clearCaches() {
    this.text.morphology?.clearCache()
    this.morphSearch?.clearCache()
  }

  /** 記錄總數 */
  get size() {
    return this.docs.count
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
      occurrences: [],
      glosses: [],
      totals: { entries: 0, occurrences: 0, glosses: 0 },
      stats: { elapsedMs: 0, visitedNodes: 0 },
    }
    if (!q) return response

    const accept = this._createFilter(filters)
    if (searchNative) {
      // 中文查詢對族語欄位只做「包含」比對：族語欄位中可能夾雜中文註記（形如「族語詞 中文詞」），
      // 但加權編輯距離對中文沒有意義
      this._searchNative(q, FUZZINESS[fuzziness] ?? FUZZINESS.normal, accept, response, explainLimit, {
        fuzzy: mode === 'latin',
      })
    }
    if (searchGloss) {
      response.glosses = mode === 'zh' ? this._searchZh(q, accept) : this._searchLatinGloss(q, accept)
    }

    response.totals = {
      entries: response.entries.length,
      occurrences: response.occurrences.length,
      glosses: response.glosses.length,
    }
    response.entries = response.entries.slice(0, limit)
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
   * @param {{fuzzy?: boolean}} [mode] fuzzy=false 時只做前綴／包含比對
   * @private
   */
  _searchNative(q, level, accept, response, explainLimit, { fuzzy = true } = {}) {
    const key = this.text.searchKey(q)
    if (!key) return
    const words = this.text.splitWords(q)

    const fullTerms = this._matchTerms(key, level, response, fuzzy)
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
    for (const hit of response.entries.slice(0, explainLimit)) {
      if (hit.matchType === 'fuzzy' && hit.distance > 0) hit.alignment = this.explainNotes(key, hit.term)
      const a = hit.analysis
      if (a && a.stemAlignment === undefined) {
        // 詞根相符：查詢中的詞幹 → 詞庫詞幹；衍生形：查詢 → 方言變體詞幹
        a.stemAlignment = a.stemSurface && a.stemSurface !== a.stem ? this.explainNotes(a.stemSurface, a.stem) : null
      }
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
      const terms = this._matchTerms(word, level, response, fuzzy)
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
      const prepared = morphology ? /** @type {NonNullable<typeof this.morphSearch>} */ (this.morphSearch).prepare(key) : null
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
      // 查詢的方言變體（純規則、距離不大）也當作詞幹去找衍生形：查 daux 也找得到 minudox
      const variants = [...matches.values()]
        .filter((m) => m.matchType === 'fuzzy' && m.distance > 0 && m.distance <= DIALECT_VARIANT_DISTANCE)
        .filter((m) => this.explainNotes(key, m.term).every((s) => s.op === 'rule'))
      // 構詞命中：同一個詞若也是前綴或包含命中，構詞的說明更有用；模糊命中則保留原本的
      for (const m of [...lemma, ...this._derivedTerms(key, variants)]) {
        const prev = matches.get(m.term)
        if (!prev || prev.matchType === 'substring' || prev.matchType === 'prefix' || m.distance < prev.distance) {
          if (prev?.matchType !== 'fuzzy') matches.set(m.term, m)
        }
      }
    }
    return [...matches.values()]
  }

  /**
   * 衍生形（還原詞綴方向）：詞庫中去詞綴後正好是查詢的詞，包括語料句子裡的詞。
   *
   * 不必列舉所有詞綴組合：前綴、後綴只加在外面，所以衍生詞一定含有詞幹的某個「核心形式」
   * （詞幹本身，或加了中綴、重疊、詞幹交替後的樣子）。先用「字元 → 詞」索引找出含核心形式的詞，
   * 再用構詞分析驗證，分析結果的詞幹必須正好是查詢。
   *
   * 查詢的方言變體（variants：純規則、距離小的模糊命中詞）也各當一次詞幹，
   * 成本加上變體本身的距離，說明中附上查詢 → 變體的對齊。
   *
   * @param {string} key
   * @param {TermMatch[]} [variants]
   * @returns {TermMatch[]}
   * @private
   */
  _derivedTerms(key, variants = []) {
    const morphology = /** @type {import('../fuzzy/morphology.js').Analyzer} */ (this.text.morphology)
    const { terms } = this._ensureTermIndex()
    /** @type {Map<string, TermMatch>} */
    const out = new Map()
    for (const { term: stem, distance: offset } of [{ term: key, distance: 0 }, ...variants]) {
      if (Array.from(stem).length < morphology.spec.minStem) continue
      const seen = new Set()
      const cores = morphology.coreForms(stem)
      for (const core of cores) {
        for (const id of this._termsContaining(core)) {
          const term = terms[id]
          if (term === key || term === stem || seen.has(term)) continue
          seen.add(term)
          // 大部分候選只是碰巧含有核心形式：先用必要條件排除，不必逐一分析（結果不變）
          if (!morphology.mayDerive(term, stem, cores)) continue
          const a = morphology.analyze(term).find((x) => x.stem === stem)
          if (!a) continue
          const distance = Math.round((a.cost + offset) * 1e9) / 1e9
          const prev = out.get(term)
          if (prev && prev.distance <= distance) continue
          out.set(term, {
            term,
            payloads: this.index.payloads[id],
            distance,
            matchType: 'derived',
            analysis: {
              stem,
              steps: a.steps,
              cost: distance,
              // 方言變體：說明「查詢 → 詞幹」的音變（stemSurface 借用為查詢本身）
              ...(offset > 0 ? { stemSurface: key, stemDistance: offset } : {}),
            },
          })
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
   * 前綴鏈、後綴鏈的成本先算成兩張圖表，當作詞圖 DP 的起始列與詞尾附加成本，一次走訪就同時處理
   * 「詞綴＋詞幹＋方言音變」，詞綴本身的音變（mine-／minu-）也在內。
   * 總成本上限＝ min(1, 該模糊程度的門檻 ＋ 0.6)；詞幹部分的音變另受規格的 lemmaDistance 限制。
   * 精確模式不做（精確只比對拼寫相同的詞）。
   *
   * @param {string} key
   * @param {typeof FUZZINESS[Fuzziness]} level
   * @param {ReturnType<NonNullable<SearchEngine['morphSearch']>['prepare']>} prepared
   * @param {import('../fuzzy/fuzzy-index.js').SearchResult[][]} results 各還原變體通道的候選
   * @returns {TermMatch[]}
   * @private
   */
  _lemmaTerms(key, level, prepared, results) {
    if (!prepared) return []
    const search = /** @type {NonNullable<typeof this.morphSearch>} */ (this.morphSearch)
    const maxDistance = Math.min(LEMMA_MAX_DISTANCE, level.maxDistance(Array.from(key).length) + LEMMA_EXTRA_DISTANCE)
    return search.finish(prepared, results, maxDistance).map((h) => ({
      term: h.term,
      payloads: h.payloads,
      distance: h.distance,
      matchType: /** @type {MatchType} */ ('lemma'),
      analysis: {
        stem: h.term,
        steps: h.steps,
        cost: h.distance,
        stemSurface: h.stemSurface,
        stemDistance: h.stemDistance,
      },
    }))
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
