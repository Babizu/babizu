/**
 * @file 搜尋引擎：載入建置輸出的 docs.json、lexicon.json（與自動派生圖、拆解表），提供族語模糊搜尋、
 * 例句搜尋、中文與英文釋義搜尋、跨來源相近詞與句型搜尋。
 *
 * 網站把它放在 Web Worker 中執行，避免阻塞畫面；也可在 Node.js 中直接使用（測試即如此）。
 *
 * ## 各部分
 * - 詞形比對（term-matcher.ts）：一個查詢詞在詞庫中的所有命中——詞圖 DAWG 上的加權編輯距離（模糊）、
 *   「字元 → 詞」反向索引（前綴、結尾、包含，substring-index.ts）、構詞搜尋 BCDP（自動拆解）、
 *   自動派生圖（自動派生、自動同根，derived-terms.ts）
 * - 族語搜尋（native-search.ts）：命中的詞依 posting 分成詞條（entry-search.ts）與例句（occurrence-search.ts）
 * - 辭典標註的構詞關係（dictionary-relations.ts）
 * - 釋義搜尋（gloss-search.ts）：中文「單字 → 記錄」、英文／臺語羅馬字「詞 → 記錄」反向索引
 * - 句型搜尋（babizu/pattern）
 * 除了詞圖之外，其餘索引都在第一次用到時才建立（warmup 可以預先建立）。
 */

import { createMorphSearch, FuzzyIndex, type LanguageProfile, type MorphSearch, type SerializedIndex } from '#bcdp'
import { atomsOf } from '../pattern/ast.ts'
import { PatternError } from '../pattern/errors.ts'
import { parsePattern } from '../pattern/parser.ts'
import { PatternSearch, type PatternResponse, type PatternSearchOptions } from '../pattern/search.ts'
import { createVirtualRootSearch, DerivationGraph, entryTest, type DerivationData } from './derivations.ts'
import { DictionaryRelations } from './dictionary-relations.ts'
import { childrenLookup } from './family.ts'
import { createDocFilter } from './filters.ts'
import { decodePosting, docAt, INDEX_FORMAT_VERSION, type DocSummary, type SearchDocs } from './format.ts'
import { fuzzyOptions, levelOf, lemmaMax } from './fuzziness.ts'
import { GlossSearch } from './gloss-search.ts'
import { searchNative } from './native-search.ts'
import { ParseChart, type ParseData } from './parses.ts'
import { compareHits, SEARCH_METHOD_GROUPS, SEARCH_METHODS, siblingTier } from './scoring.ts'
import { TermMatcher } from './term-matcher.ts'
import { createTextTools, detectQueryMode, type TextTools } from './text.ts'
import type { AlignmentNote, EntryHit, Fuzziness, ListOptions, SearchFilters, SearchOptions, SearchResponse } from './types.ts'

/** 搜尋引擎的資料 */
export interface SearchEngineData {
  docs: SearchDocs
  lexicon: SerializedIndex
  /** 必須是建索引時用的同一份語言設定檔（建置輸出的 search/language.json） */
  profile: LanguageProfile
  /** 自動派生圖（search/derivations.json，見 derivations.ts），沒有時不找自動派生形 */
  derivations?: DerivationData | null
  /**
   * 拆解表（search/parses.json，見 parses.ts），句型搜尋的構詞樣式要用。網站在第一次需要時才載入，
   * 之後以 attachParseChart 接上（needsParseChart 判斷要不要）
   */
  parses?: ParseData | null
}

export class SearchEngine {
  readonly docs: SearchDocs
  readonly text: TextTools
  readonly metric: ReturnType<TextTools['createSearchMetric']>
  readonly index: FuzzyIndex
  /** 構詞搜尋 BCDP（語言設定檔有 morphology 時才有），見 @babizu/bcdp 的 morph-search.ts 與 docs/bcdp.md */
  readonly morphSearch: MorphSearch | null
  /** 自動派生圖（查詞根找自動派生形，見 derivations.ts） */
  readonly derivations: DerivationGraph | null
  /** 拆解表（句型搜尋的構詞樣式用，見 parses.ts） */
  parses: ParseChart | null
  /** 詞形比對：一個查詢詞在詞庫中的所有命中（一般搜尋與句型搜尋共用） */
  readonly terms: TermMatcher
  /** 辭典標註的構詞關係 */
  readonly relations: DictionaryRelations
  /** 記錄 → 資料中的下層記錄（docs.parent 的反向對照） */
  readonly childrenOf: (k: number) => readonly number[]
  private readonly glosses: GlossSearch
  /** 虛擬詞根用的構詞搜尋（第一次用到時建立，virtualRootSearch） */
  private _virtualRootSearch: MorphSearch | null = null
  private _idIndex: Map<string, number> | null = null
  private _listCache: { key: string; indices: number[] } | null = null
  /** 句型搜尋（第一次用到時建立，見 babizu/pattern） */
  private _pattern: PatternSearch | null = null

  constructor({ docs, lexicon, profile, derivations = null, parses = null }: SearchEngineData) {
    if (docs.version !== INDEX_FORMAT_VERSION) {
      throw new Error(`搜尋索引格式版本 ${docs.version} 與框架（${INDEX_FORMAT_VERSION}）不符，請重新建置網站`)
    }
    this.docs = docs
    this.text = createTextTools(profile)
    this.metric = this.text.createSearchMetric()
    this.index = FuzzyIndex.deserialize(lexicon, this.metric)
    this.morphSearch = this.text.morphology
      ? createMorphSearch({ analyzer: this.text.morphology, metric: this.metric, index: this.index, isEntry: entryTest(this.index) })
      : null
    this.derivations = derivations && this.morphSearch ? new DerivationGraph(derivations, this.index.terms, this.morphSearch.rootCost) : null
    this.parses = parses && this.morphSearch ? new ParseChart(parses, this.index.terms, this.morphSearch.rootCost) : null
    this.terms = new TermMatcher({
      index: this.index,
      morphSearch: this.morphSearch,
      derivations: this.derivations,
      virtualRootSearch: () => this.virtualRootSearch,
      explainNotes: (query, term) => this.explainNotes(query, term),
    })
    this.childrenOf = childrenLookup(docs.parent)
    this.relations = new DictionaryRelations(docs, this.index, this.text, this.childrenOf)
    this.glosses = new GlossSearch(docs, (k) => this.doc(k))
  }

  /**
   * 句型搜尋：依詞序與構詞搜尋記錄（docs/pattern-query.md）。
   * @param query 句型查詢，例如 `yaku ka _* isiw`、`pa-… ki _`
   */
  searchPattern(query: string, options: PatternSearchOptions = {}): PatternResponse {
    return this.pattern.search(query, options)
  }

  /** 句型搜尋本身（第一次用到時建立）。檢查清單的人工拆解對照也用它：構詞樣式的解析與比對與搜尋相同。 */
  get pattern(): PatternSearch {
    return (this._pattern ??= new PatternSearch(this))
  }

  /**
   * 這個句型查詢需不需要先載入拆解表：有構詞規格、還沒有拆解表，而且查詢中有構詞樣式。
   * 查詢有語法錯誤時不需要（searchPattern 會回報錯誤）。
   */
  needsParseChart(query: string): boolean {
    if (!this.morphSearch || this.parses) return false
    try {
      return parsePattern(query).conditions.some((c) => [...atomsOf(c.body)].some((n) => n.atom.kind === 'morph'))
    } catch (err) {
      if (err instanceof PatternError) return false
      throw err
    }
  }

  /** 接上拆解表（網站在第一次需要時才載入 search/parses.json）。 */
  attachParseChart(data: ParseData): void {
    if (!this.morphSearch) return
    this.parses = new ParseChart(data, this.index.terms, this.morphSearch.rootCost)
    this._pattern?.reset()
  }

  /** 預先建立第一次查詢時才建立的索引，讓第一次查詢不必等待（適合在 Worker 載入完成後呼叫）。 */
  warmup(): void {
    this.glosses.warmup()
    this.terms.warmup()
    this.docById('')
  }

  /**
   * 構詞搜尋（BCDP）的完整說明，給演算法實驗室逐步展示（docs/lab-design.md）。
   * 查詢與詞根都先轉成搜尋鍵；總成本上限與搜尋相同，所以 hit 就是搜尋對這個詞根的結果。
   * @param term 要逐格計價的詞根（省略時只列出命中）
   * @returns 語言設定檔沒有構詞規格時為 null
   */
  explainMorphology(query: string, term: string | null = null, { fuzziness = 'normal' }: { fuzziness?: Fuzziness } = {}): ReturnType<MorphSearch['explain']> | null {
    if (!this.morphSearch) return null
    const key = this.text.searchKey(query)
    return this.morphSearch.explain(key, term === null ? null : this.text.searchKey(term), { maxDistance: lemmaMax(key, levelOf(fuzziness)) })
  }

  /** 清掉跨查詢的快取（構詞搜尋的詞綴鏈），不影響結果。量測「沒有快取」的耗時時用。 */
  clearCaches(): void {
    this.morphSearch?.clearCache()
    this._virtualRootSearch?.clearCache()
  }

  /**
   * 虛擬詞根用的構詞搜尋（只有構詞音變的距離函式，derivations.ts 的 createVirtualRootSearch）；
   * 語言設定檔沒有 morphology 時為 null。第一次用到時建立。
   */
  get virtualRootSearch(): MorphSearch | null {
    if (!this.morphSearch) return null
    return (this._virtualRootSearch ??= createVirtualRootSearch(this.text, this.index))
  }

  /** 記錄總數 */
  get size(): number {
    return this.docs.count
  }

  doc(k: number): DocSummary {
    return docAt(this.docs, k)
  }

  /** 依記錄 id 取得摘要。 */
  docById(id: string): DocSummary | null {
    if (!this._idIndex) this._idIndex = new Map(this.docs.id.map((x, k) => [x, k]))
    const k = this._idIndex.get(id)
    return k === undefined ? null : this.doc(k)
  }

  /** 篩選條件 → 記錄是否保留（句型搜尋也用）。 */
  createFilter(filters: SearchFilters = {}): (k: number) => boolean {
    return createDocFilter(this.docs, filters)
  }

  /** 主搜尋。 */
  search(query: string, options: SearchOptions = {}): SearchResponse {
    const started = now()
    const {
      fuzziness = 'normal',
      filters = {},
      fields = ['native', 'gloss'],
      limit = 500,
      explainLimit = 40,
      exclude = [],
    } = options
    const q = String(query ?? '').trim()
    const mode = detectQueryMode(q)
    const response: SearchResponse = {
      query: q,
      mode,
      terms: [],
      entries: [],
      entryGroups: [],
      occurrences: [],
      glosses: [],
      totals: { entries: 0, entryGroups: 0, occurrences: 0, glosses: 0 },
      methods: Object.fromEntries(SEARCH_METHODS.map((m) => [m, 0])) as SearchResponse['methods'],
      methodGroups: Object.fromEntries(Object.keys(SEARCH_METHOD_GROUPS).map((g) => [g, 0])) as SearchResponse['methodGroups'],
      stats: { elapsedMs: 0, visitedNodes: 0 },
    }
    if (!q) return response

    const accept = this.createFilter(filters)
    if (fields.includes('native')) {
      // 中文查詢對族語欄位只做「包含」比對：族語欄位中可能夾雜中文註記（形如「族語詞 中文詞」），
      // 但加權編輯距離對中文沒有意義
      searchNative(this, q, response, { level: levelOf(fuzziness), accept, explainLimit, fuzzy: mode === 'latin', exclude: new Set(exclude) })
    }
    if (fields.includes('gloss')) {
      response.glosses = mode === 'zh' ? this.glosses.searchZh(q, accept) : this.glosses.searchLatin(q, accept)
    }

    response.totals = {
      entries: response.entries.length,
      entryGroups: response.entryGroups.length,
      occurrences: response.occurrences.length,
      glosses: response.glosses.length,
    }
    // 上限只算原本的命中；自動同根（已排在最後）另外全列，不擠掉原本的（siblingTier）
    const capped = <T>(list: T[], tier: (x: T) => number) => {
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
   */
  list({ filters = {}, sort = 'text', offset = 0, limit = 100 }: ListOptions = {}): { items: DocSummary[]; total: number } {
    const key = JSON.stringify([filters, sort])
    let indices = this._listCache?.key === key ? this._listCache.indices : null
    if (!indices) {
      const accept = this.createFilter(filters)
      indices = []
      for (let k = 0; k < this.docs.count; k++) if (accept(k)) indices.push(k)
      if (sort === 'text') {
        const keys = new Map(indices.map((k) => [k, this.text.searchKey(this.docs.text[k])]))
        indices.sort((a, b) => {
          const ka = keys.get(a) as string
          const kb = keys.get(b) as string
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
   * @param id 記錄 id
   */
  neighbors(id: string, { fuzziness = 'normal', limit = 20 }: { fuzziness?: Fuzziness; limit?: number } = {}): EntryHit[] {
    const doc = this.docById(id)
    if (!doc || doc.unit === 'sentence') return []
    const key = this.text.searchKey(doc.text)
    if (!key) return []
    const terms = this.index.search(key, fuzzyOptions(key, levelOf(fuzziness)))

    const best = new Map<number, EntryHit>()
    for (const t of terms) {
      for (const code of t.payloads as number[]) {
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
            matchType: 'fuzzy',
            kind,
            alignment: null,
          })
        }
      }
    }
    const hits = [...best.values()].sort(compareHits).slice(0, limit)
    for (const hit of hits) hit.alignment = this.explainNotes(key, hit.term)
    return hits
  }

  /** 兩個詞的對齊說明（只列出非相同字元的步驟）。 */
  explainNotes(query: string, term: string): AlignmentNote[] {
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

}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
