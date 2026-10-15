/**
 * @file 模糊搜尋的索引：以 DAWG（詞圖）存放詞庫，找出所有「距離在門檻內」的詞。
 *
 * 底層結構是 DAWG（見 dawg.ts）：它同時合併共同前綴與共同後綴，節點數比 Trie 少很多。
 * 對搜尋演算法而言介面幾乎一樣（取子節點、是否為詞尾、子樹高度），差別有兩點：
 * - 節點會被多個詞共用，所以附帶資料不能掛在節點上。改用完美雜湊：DFS 沿著邊累加
 *   `wordsBefore`，抵達詞尾時就得到這個詞的字典序名次，再用名次索引 payload 陣列。
 * - 同一個節點可能出現在走訪的不同位置（共用後綴）。這不影響正確性：
 *   DP 的列取決於「走到這裡的路徑」，而 DFS 中每條路徑只會走一次。
 *
 * 搜尋本身（深度優先走訪詞圖＋逐列 DP＋剪枝，多個通道一起走）在 channel-walk.ts，剪枝的正確性也在那裡說明。
 */

import { createChannel, walk, type Channel } from './channel-walk.ts'
import { Dawg, type SerializedDawg } from './dawg.ts'
import type { WeightedEditDistance } from './distance.ts'
import { PathMatcher, type CompiledRules, type QueryPlan } from './dp.ts'
import { requireLimit, requireString } from './guards.ts'
import type { JunctionEnd, JunctionState } from './junction.ts'
import type { NormalizationStrategy } from './score-normalization.ts'

export type { JunctionEnd, JunctionState } from './junction.ts'

export interface SearchOptions {
  /** 絕對距離上限（含；預設 1） */
  maxDistance?: number
  /** 正規化分數上限（含；預設 Infinity） */
  maxNormalized?: number
  /** 用於 score 與 maxNormalized（預設 'none'） */
  normalization?: string | Partial<NormalizationStrategy>
  /** 最多回傳幾筆（預設 Infinity） */
  limit?: number
  /** 每走訪一個節點回呼一次（視覺化用） */
  onNode?: (event: NodeVisit) => void
  /** 第 0 列的起點成本（長度 = 查詢長度 + 1）：沒有跨界狀態的 from */
  start?: ArrayLike<number>
  /** 詞尾在查詢各位置結束的附加成本（長度同上）：沒有跨界狀態的 to */
  end?: ArrayLike<number>
  /** 起點：前一段留下的交界狀態（位置 0 是詞素交界） */
  from?: JunctionState
  /** 位置 0 的種類（dp.ts 的 EDGE_*）；預設有 from 時是交界，否則是詞首 */
  startEdge?: number
  /** 詞尾：與後一段的交界狀態耦合；結果的 distance 是整個詞的成本 */
  to?: JunctionEnd
  /** 每走到一個詞尾就回呼一次，附上這一段結束時的交界狀態（複本） */
  onJunction?: (term: string, state: JunctionState, payloads: unknown[]) => void
  /** 查詢的邊界字元（空白）完全不能被消耗（詞綴不含空白；預設 false） */
  lockBoundary?: boolean
  /**
   * 第一個字元在 initials 中的詞改由 initialFrom.from 出發，其他詞照常由 from 出發（沒有 from 時不走）。
   * 只有第 0 列依根節點的邊切換，之後的列照常計算
   * （構詞：要求詞根元音開頭的環綴併進後綴相同的通道，docs/bcdp.md 第 7 節）
   */
  initialFrom?: { initials: Set<string>; from: JunctionState }
  /**
   * 相對上限（可由多個通道共用）：只需要「最佳 ＋ spread」之內的結果時，上限隨目前找到的最佳結果收緊。
   * 最後的最佳一定不大於途中的最佳，所以最佳 ＋ spread 之內的詞一個也不會少
   */
  cutoff?: SpreadCutoff
  /** 每走到一個詞尾就回呼一次，附上完整的 F 列（row[i] = 查詢前 i 個字元轉成這個詞的成本） */
  onTerminal?: (term: string, row: Float64Array, payloads: unknown[]) => void
}

/** 相對上限的共用狀態（走訪時會被改寫） */
export interface SpreadCutoff {
  /** 目前找到的最小距離（初始 Infinity） */
  best: number
  /** 只保留距離不超過「最佳 ＋ spread」的結果 */
  spread: number
  /** 哪些詞算進最佳（呼叫端之後會丟掉的詞不能收緊上限） */
  eligible?: (term: string) => boolean
  /**
   * 呼叫端之後另加在這個詞上的非負成本（構詞的詞根音節數）：最佳以加上它的總和計算
   * （呼叫端也以總和排名、取「最佳 ＋ spread」之內的）。剪枝比的是不含它的距離，它只會讓總和更大，所以仍然精確
   */
  termCost?: (term: string) => number
}

export interface NodeVisit {
  /** 此節點代表的前綴 */
  prefix: string
  depth: number
  /** 詞圖中的節點編號（共用後綴時會在不同位置重複出現） */
  node: number
  /** 子樹內任何詞的距離下界 */
  lowerBound: number
  /** 此子樹允許的絕對距離上界 */
  bound: number
  /** 是否在此剪枝 */
  pruned: boolean
  /** 此節點是否為詞尾 */
  terminal: boolean
  /** 若為詞尾，該詞的距離 */
  distance: number | null
  /** 若為詞尾，是否符合門檻 */
  accepted: boolean
}

/**
 * 有 to 時，最小值來自哪裡：詞尾（word）、交界列（row）、跨界規則（pending，tail 是 to.pending 的序號，
 * x 是後一段開始的位置）
 */
export interface CoupleExit {
  kind: 'word' | 'row' | 'pending'
  x: number
  tail: number
}

export interface SearchResult {
  /** 詞庫中的詞（已正規化） */
  term: string
  /** 絕對距離 */
  distance: number
  /** 正規化分數（normalization='none' 時等於 distance） */
  score: number
  /** 加入詞庫時附帶的資料 */
  payloads: unknown[]
  /** 有 to 時，詞在查詢中結束的位置（達到最小值的 x） */
  endAt?: number
  exit?: CoupleExit
}

export interface SearchStats {
  visitedNodes: number
  prunedNodes: number
  computedRows: number
}

export interface SerializedIndex {
  format: string
  version: number
  dawg: SerializedDawg
  /** 依詞的字典序排列 */
  payloads: unknown[][]
}

/** 一個通道：查詢可以是字串（先正規化），或已正規化的 code point 陣列（原樣使用） */
export interface ChannelSpec {
  query: string | string[]
  options?: SearchOptions
}

export const INDEX_FORMAT = 'pazeh-fuzzy-index'
export const INDEX_VERSION = 2

export class FuzzyIndex {
  readonly metric: WeightedEditDistance
  /** 建構中的詞與附帶資料；凍結後釋放 */
  private _entries: Map<string, unknown[]> | null
  private _dawg: Dawg | null
  /** 依詞的字典序排列 */
  private _payloads: unknown[][]
  /** 詞表快取（需要逐詞比對時才展開） */
  private _terms: string[] | null = null
  /** 邊標籤的字元編號（見 _edgeCodes） */
  private _codes: { compiled: CompiledRules; dawg: Dawg; codes: Int32Array; boundary: Uint8Array } | null = null
  /** 上一次走訪用過、目前沒被借走的路徑匹配器（見 _searchChannels） */
  private _spareMatcher: PathMatcher | null = null

  /**
   * @param built 已建好的詞圖（反序列化時使用）
   */
  constructor(metric: WeightedEditDistance, built?: { dawg: Dawg; payloads: unknown[][] }) {
    this.metric = metric
    this._entries = built ? null : new Map()
    this._dawg = built?.dawg ?? null
    this._payloads = built?.payloads ?? []
  }

  /** 詞數 */
  get size(): number {
    return this._entries ? this._entries.size : this.dawg.size
  }

  /** 詞圖（第一次使用時才建立） */
  get dawg(): Dawg {
    if (!this._dawg) this.freeze()
    return this._dawg as Dawg
  }

  /** 所有詞（字典序）。第一次呼叫時才展開成陣列。 */
  get terms(): string[] {
    if (!this._terms) this._terms = this.dawg.words()
    return this._terms
  }

  /** 每個詞的附帶資料，順序與 `terms` 相同 */
  get payloads(): unknown[][] {
    this.dawg // 確保已建立
    return this._payloads
  }

  /**
   * 加入一個詞。詞會先經過 metric 的正規化；正規化後為空字串的詞會被忽略。
   * @param payload 附帶資料（例如資料庫中的記錄編號）
   */
  add(term: string, payload?: unknown): this {
    requireString(term, '詞')
    const key = this.metric.normalize(term)
    if (key === '') return this
    const entries = this._unfreeze()
    let list = entries.get(key)
    if (!list) entries.set(key, (list = []))
    if (payload !== undefined) list.push(payload)
    return this
  }

  /** 批次加入。 */
  addAll(items: Iterable<[string, unknown] | string>): this {
    for (const item of items) {
      if (Array.isArray(item)) this.add(item[0], item[1])
      else this.add(item)
    }
    return this
  }

  /** 建立詞圖。加入新詞後會在下一次使用時自動重建，一般不需要自己呼叫。 */
  freeze(): this {
    const entries = this._entries ?? new Map<string, unknown[]>()
    const dawg = Dawg.build([...entries.keys()])
    const payloads: unknown[][] = new Array(dawg.size)
    for (const [term, list] of entries) payloads[dawg.lookup(term)] = list
    for (let k = 0; k < payloads.length; k++) payloads[k] ??= []
    this._dawg = dawg
    this._payloads = payloads
    this._entries = null
    this._terms = null
    return this
  }

  /** 回到可新增詞的狀態（必要時由詞圖還原）。 */
  private _unfreeze(): Map<string, unknown[]> {
    if (this._entries) return this._entries
    const entries = new Map<string, unknown[]>()
    if (this._dawg) this.terms.forEach((term, k) => entries.set(term, this._payloads[k] ?? []))
    this._entries = entries
    this._dawg = null
    this._terms = null
    return entries
  }

  /** 精確查詢（經正規化）。 */
  lookup(term: string): unknown[] | undefined {
    const index = this.dawg.lookup(this.metric.normalize(term))
    return index === -1 ? undefined : this._payloads[index]
  }

  /** 依詞的字典序名次取得詞與附帶資料（名次超出範圍時 term 是 null、payloads 是 undefined）。 */
  entry(id: number): { term: string | null; payloads: unknown[] | undefined } {
    return { term: this.dawg.wordAt(id), payloads: this._payloads[id] }
  }

  /**
   * 模糊搜尋。
   * @returns 依 score、distance、詞排序
   *
   * @example
   * index.search('bintul', { maxDistance: 0.5 })
   * // → [{ term: 'bintun', distance: 0.1, score: 0.1, payloads: [...] }, ...]
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    return this.searchWithStats(query, options).results
  }

  /** 模糊搜尋，並回傳走訪統計。 */
  searchWithStats(query: string, options: SearchOptions = {}): { results: SearchResult[]; stats: SearchStats } {
    const { limit = Infinity } = options
    requireLimit(limit, 'limit ')
    const stats = { visitedNodes: 0, prunedNodes: 0, computedRows: 0 }
    const results = this._searchChannels([{ query, options }], stats)[0].sort(
      (a, b) => a.score - b.score || a.distance - b.distance || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0),
    )
    return { results: Number.isFinite(limit) ? results.slice(0, limit) : results, stats }
  }

  /**
   * 多通道搜尋：一次詞圖走訪同時跑好幾組查詢／邊界條件（例如普通模糊搜尋＋構詞搜尋的各個還原變體）。
   *
   * 每個通道有自己的 DP 列、上限與剪枝；某個通道在一個節點被剪掉，只是它不再往下算，
   * 其他通道照常進行，所有通道都剪掉時才停止往下走。所以每個通道的結果與單獨搜尋完全相同，
   * 但詞圖的走訪、路徑維護、出邊檢查只做一次。通道數沒有上限（每一層記一份存活通道的清單）。
   *
   * 通道的 query 可以是字串（先經過 metric 的正規化），也可以是**已正規化的 code point 陣列**
   * （原樣使用、不再正規化）。構詞搜尋用後者：它的查詢片段取自已正規化的查詢，
   * 再正規化一次可能改變片段（例如截掉頭尾空白），位置就會錯開（docs/bcdp.md 第 11 節）。
   *
   * @param stats 累加統計（走訪節點數以實際走訪計，不按通道重複計算）
   * @returns 各通道的結果（未排序）
   */
  searchChannels(channels: ChannelSpec[], stats: SearchStats = { visitedNodes: 0, prunedNodes: 0, computedRows: 0 }): SearchResult[][] {
    return this._searchChannels(
      channels.map((c) => ({ query: c.query, options: c.options ?? {} })),
      stats,
    )
  }

  /**
   * 搜尋主體：詞圖深度優先走訪 + 逐列 DP + 剪枝（可同時跑多個通道）。
   * @param stats 累加統計
   */
  private _searchChannels(specs: Array<{ query: string | string[]; options: SearchOptions }>, stats: SearchStats): SearchResult[][] {
    if (specs.length === 0) return []
    const { compiled, costs } = this.metric
    const dawg = this.dawg
    const { codes, boundary } = this._edgeCodes(compiled)
    /**
     * 路徑匹配器（所有通道共用）重複使用上一次的（每一層都由上一層重算，不會留下舊狀態）；
     * 走訪中的回呼若又搜尋同一個索引，那一次拿不到這個（已被借走），會另建一個。
     */
    const spare = this._spareMatcher
    const matcher = spare && spare.compiled === compiled ? spare : new PathMatcher(compiled)
    this._spareMatcher = null
    /** 第 r 列（r < 目前深度）是否該用 F 列：看路徑上第 r 個字元是否為邊界 */
    const useF = (r: number) => matcher.boundary[r] === 1

    /**
     * 查詢端的編譯結果依（查詢、交界、鎖住空白）共用：通道之間只差在起點列。複本共用成本表的快取與
     * 暫存（ColumnContext、ruleMin）；每個節點上一個通道的列算完才換下一個通道，所以暫存不會互相覆寫
     */
    const plans = new Map<string, QueryPlan>()
    const planFor = (x: string[], start: Float64Array | null, junctions: boolean, lockBoundary: boolean): QueryPlan => {
      const key = `${junctions ? 1 : 0}${lockBoundary ? 1 : 0}${x.join('\u0001')}`
      let base = plans.get(key)
      if (!base) plans.set(key, (base = compiled.compileQuery(x, costs, { start: null, junctions, lockBoundary })))
      return start ? { ...base, start: Float64Array.from(start) } : base
    }
    const channels: Channel[] = specs.map(({ query, options }) => createChannel(Array.isArray(query) ? query : this.metric.prepare(query), options, planFor, useF))

    try {
      walk({
        compiled,
        dawg,
        payloads: this._payloads,
        codes,
        boundary,
        matcher,
        path: [],
        stats,
        channels,
        alive: [],
        aliveCount: [],
        hasInitial: channels.some((ch) => ch.initial),
      })
    } finally {
      this._spareMatcher = matcher
    }
    return channels.map((c) => c.results)
  }

  /**
   * 詞圖每條邊的字元編號與邊界旗標。字元編號屬於某一組規則（CompiledRules），
   * 所以快取時記下是哪一組；詞圖重建（freeze）或規則替換（setRules）後自動重算。
   */
  private _edgeCodes(compiled: CompiledRules): { codes: Int32Array; boundary: Uint8Array } {
    const dawg = this.dawg
    const cached = this._codes
    if (cached && cached.compiled === compiled && cached.dawg === dawg) return cached
    const edges = dawg.edgeLabels.length
    const codes = new Int32Array(edges)
    const boundary = new Uint8Array(edges)
    for (let e = 0; e < edges; e++) {
      codes[e] = compiled.idOf(dawg.label(e))
      boundary[e] = compiled.isBoundaryId(codes[e]) ? 1 : 0
    }
    this._codes = { compiled, dawg, codes, boundary }
    return this._codes
  }

  /**
   * 序列化為可 JSON 化的物件（不含 metric；還原時需提供相同設定的 metric）。
   * format 的值沿用最初的名稱，改了會讓既有的索引檔失效。
   */
  serialize(): SerializedIndex {
    return {
      format: INDEX_FORMAT,
      version: INDEX_VERSION,
      dawg: this.dawg.toJSON(),
      payloads: this._payloads,
    }
  }

  /** 由序列化資料還原索引。 */
  static deserialize(data: SerializedIndex, metric: WeightedEditDistance): FuzzyIndex {
    if (data?.format !== INDEX_FORMAT) {
      throw new TypeError(`不是可辨識的序列化索引（format 應為 ${INDEX_FORMAT}）`)
    }
    if (data.version !== INDEX_VERSION) throw new RangeError(`不支援的序列化版本 ${data.version}`)
    return new FuzzyIndex(metric, { dawg: Dawg.fromJSON(data.dawg), payloads: data.payloads })
  }
}
