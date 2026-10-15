/**
 * @file 以 DAWG（詞圖）＋ 動態規劃剪枝，找出詞庫中所有「距離在門檻內」的詞。
 *
 * ## 做法
 * 深度優先走訪詞圖。走到深度 j 的節點，就代表候選字串 Y 的前 j 個字元已確定，
 * 這時算出 DP 的第 j 列。共用前綴的詞共用上層的列，不必重算。
 *
 * 底層結構是 DAWG（見 dawg.ts）：它同時合併共同前綴與共同後綴，節點數比 Trie 少很多。
 * 對搜尋演算法而言介面幾乎一樣（取子節點、是否為詞尾、子樹高度），差別有兩點：
 * - 節點會被多個詞共用，所以附帶資料不能掛在節點上。改用完美雜湊：DFS 沿著邊累加
 *   `wordsBefore`，抵達詞尾時就得到這個詞的字典序名次，再用名次索引 payload 陣列。
 * - 同一個節點可能出現在走訪的不同位置（共用後綴）。這不影響正確性：
 *   DP 的列取決於「走到這裡的路徑」，而 DFS 中每條路徑只會走一次。
 *
 * ## 詞尾規則
 * 每個節點最多算兩列（見 dp.ts 檔頭）：N_j 假設下一字元不是邊界，F_j 假設是詞尾。
 * - 節點本身是詞尾時，距離取 F_j[N]
 * - 子節點引用第 j 列時，依子節點字元是否為邊界選用 F_j 或 N_j
 * 因此 F_j 只在「本節點是詞尾」或「有邊界字元的子節點」時才需要計算，大多數節點只算一列。
 *
 * ## 剪枝的正確性
 * 所有成本非負，所以沿任何 DP 路徑累積的成本單調不減。一次轉移最多跨越
 * L = 最長規則 target 長度 列，因此任何通往更深列的路徑，最後一個「列 ≤ j」的格子
 * 必落在第 j-L+1 … j 列之內，下一步再離開到第 j 列以下：
 * - 若該格在第 j 列：下一步進入某個子節點 c，來源列是 N_j（c 非邊界）或 F_j（c 是邊界），
 *   成本 ≥ 對應列的最小值
 * - 若該格在第 r 列（r < j）：下一步必須是一條 target 長度 > j-r 的規則，且 target 的
 *   前 j-r 個字元必須等於路徑上已確定的 path[r..j)。成本 ≥ min(第 r 列) + 這類規則的最小權重。
 * 兩者取最小即為子樹下界；下界超過上界時整棵子樹都不可能有符合的詞，可以安全剪掉。
 *
 * 注意：若只看當前第 j 列的最小值（一般 Levenshtein Trie 的做法）在有多字元規則時
 * 是錯的——像 aru→aw 這種規則可以直接從第 j-1 列跳到第 j+1 列，越過第 j 列。
 * 反過來，若不檢查 target 前綴而把前 L 列全部納入，下界又會太鬆（預設規則有
 * say→tshay，L = 5，前 5 層幾乎無法剪枝）。
 * 測試中的「暴力比對性質測試」用來保證剪枝不會漏掉任何結果。
 *
 * ## 詞素交界（構詞搜尋，docs/bcdp.md 第 4–7 節）
 * 構詞搜尋把「前綴鏈 · 詞幹 · 後綴鏈」看成一條底層字串，每一段各走一次（詞綴 trie 或詞庫詞圖），
 * 段與段之間以「交界狀態」銜接（dp.ts 檔頭）：
 * - `from`：起點是前一段留下的交界狀態——交界列當作第 0 列，還沒走完的規則 target 由跨界狀態延續
 * - `onJunction`：走到詞尾時回報這一段結束時的交界狀態（前綴鏈、後綴鏈一段一段接下去）
 * - `to`：走到詞尾時與後一段的交界狀態（由反方向算好）耦合，得到整個詞的成本
 * 交界狀態的值都 ≥ 0，所以上面的下界照樣成立；普通搜尋沒有交界。
 * `start`、`end` 兩個向量是沒有跨界狀態的特例。
 * `initialFrom`：以某些字元開頭的詞改用另一個起點。第 0 列只由起點決定，所以在根節點算好兩套第 0 列，
 * 走進每條邊之前依邊的字元換上其中一套；之後的列都由第 0 列算出，照常計算。
 *
 * ## 實作上的最佳化（結果與最佳化前逐位元相同）
 * - 詞圖的邊標籤預先轉成字元編號（`_edgeCodes`，每個索引、每組規則只算一次），
 *   並預先標出哪些邊是邊界字元，走訪時不再做字串比較。
 * - 路徑上的規則 target 匹配與跨列剪枝改由 `PathMatcher` 逐層維護（見 dp.ts 檔頭第 3 點）。
 *   它只依賴路徑、與通道無關，所以每個節點只算一次，所有通道共用。
 * - 列的最小值由 `fillRow` 順便回傳。
 */

import { Dawg, type SerializedDawg } from './dawg.ts'
import type { WeightedEditDistance } from './distance.ts'
import {
  advanceCrossing,
  createCrossing,
  EDGE_JUNCTION,
  EDGE_WORD,
  EPSILON,
  fillRow,
  jumpBound,
  PathMatcher,
  prepareColumn,
  roundCost,
  type CompiledRules,
  type Crossing,
  type QueryPlan,
} from './dp.ts'
import { requireCost, requireLimit, requireString } from './guards.ts'
import type { JunctionEnd, JunctionState } from './junction.ts'
import { resolveNormalization, type NormalizationStrategy } from './score-normalization.ts'

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

/** 以 initials 開頭的詞的第 0 列（根節點算好，走進每條邊之前換上） */
interface InitialRow {
  initials: Set<string>
  plan: QueryPlan
  cross: Crossing | null
  rowN: Float64Array
  rowF: Float64Array
  useF: boolean
  minN: number
  minF: number
  /** 由這一套出發的子樹下界 */
  lowerBound: number
}

/** 原本那一套第 0 列（根節點算完時記下） */
interface BaseRow {
  rowN: Float64Array
  rowF: Float64Array
  minN: number
  minF: number
  cross: Crossing | null
  lowerBound: number
}

/** 走訪中一個通道的狀態 */
interface Channel {
  n: number
  from: JunctionState | null
  to: JunctionEnd | null
  startEdge: number
  /** 第 j 層的跨界狀態（來自 from.pending，只在淺層） */
  cross: Crossing[]
  /** 詞尾耦合的位能（見建立通道處）；處處是 0 時為 null */
  pot: Float64Array | null
  /** 詞尾的交界列（算完立刻使用，所以每個通道一個緩衝就夠） */
  rowJ: Float64Array | null
  /** 跨界耦合：（這一段尾巴的 trie 節點, to.pending 的序號）→ 規則 target 編號（-1 表示沒有） */
  coupleTarget: Map<number, number>
  maxDistance: number
  cutoff: SpreadCutoff | null
  maxNormalized: number
  norm: NormalizationStrategy
  onNode: SearchOptions['onNode']
  onTerminal: SearchOptions['onTerminal']
  onJunction: SearchOptions['onJunction']
  initial: InitialRow | null
  base0: BaseRow | null
  bound0: number
  plan: QueryPlan
  /**
   * rowsN[j]、rowsF[j]：路徑上第 j 層的兩種列；minN[j]、minF[j] 為各列最小值。
   * 同一深度的兄弟節點依序走訪，前一個兄弟的子樹走完才會覆寫，所以每層各配置一次即可重複使用。
   */
  rowsN: Float64Array[]
  /** rowsF[j] 是 F 列；不需要 F 列時與 rowsN[j] 是同一個陣列 */
  rowsF: Float64Array[]
  /** F 列自己的緩衝（每層一個）：rowsF[j] 指回 rowsN[j] 之後不必重新配置 */
  bufF: Float64Array[]
  minN: number[]
  minF: number[]
  rowAt: (r: number) => Float64Array
  /** 第 r 列的最小值（跨列剪枝 jumpBound 用；每個通道建立一次，不在每個節點配置閉包） */
  minAt: (r: number) => number
  results: SearchResult[]
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
    const payloads = this._payloads
    const { codes, boundary } = this._edgeCodes(compiled)

    /** 目前走訪路徑上的字元（所有通道共用；只在組出結果的詞時使用） */
    const path: string[] = []
    /**
     * 路徑上的字元編號、邊界旗標與規則 target 的 trie 狀態（所有通道共用）。
     * 重複使用上一次的（每一層都由上一層重算，不會留下舊狀態）；走訪中的回呼若又搜尋同一個索引，
     * 那一次拿不到這個（已被借走），會另建一個。
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

    const channels = specs.map(({ query, options }): Channel => {
      const x = Array.isArray(query) ? query : this.metric.prepare(query)
      if (options.maxDistance !== undefined) requireCost(options.maxDistance, 'maxDistance ')
      const n = x.length
      // start／end 是沒有跨界狀態的 from／to；只有 initialFrom 時，其他詞沒有起點（全部是 Infinity）
      const initialFrom = options.initialFrom ?? null
      const from: JunctionState | null =
        options.from ??
        (options.start ? { row: Float64Array.from(options.start), pending: [] } : initialFrom ? { row: new Float64Array(n + 1).fill(Infinity), pending: [] } : null)
      const to: JunctionEnd | null = options.to ?? (options.end ? { row: Float64Array.from(options.end), pending: [], word: null } : null)
      const vectors = [
        from?.row,
        ...(from?.pending ?? []).map((p) => p.row),
        initialFrom?.from.row,
        ...(initialFrom?.from.pending ?? []).map((p) => p.row),
        to?.row,
        to?.word,
        ...(to?.pending ?? []).map((p) => p.row),
      ]
      for (const vec of vectors) {
        if (vec && vec.length !== n + 1) throw new RangeError(`start／end（交界狀態）的長度必須是查詢長度 + 1（${n + 1}）`)
        // 剪枝的下界依賴「交界成本不小於 0」（docs/bcdp.md 第 7 節）
        if (vec && !Array.prototype.every.call(vec, (c: number) => c >= 0)) throw new RangeError('start／end（交界狀態）的值必須是非負數或 Infinity')
      }
      // 詞尾耦合的位能：pot[x] ＝ 在查詢位置 x 或之後結束時，至少還要付的耦合成本。對齊的查詢位置只會往後走，
      // 所以子樹的下界可以用 min_x（列[x] ＋ pot[x]）取代列的最小值（docs/bcdp.md 第 7 節）。
      // 允許直接在詞尾結束（to.word[n] ＝ 0）時位能處處是 0，不必計算
      let pot: Float64Array | null = null
      if (to) {
        const e = new Float64Array(n + 1).fill(Infinity)
        for (const vec of [to.row, to.word, ...to.pending.map((p) => p.row)]) {
          if (vec) for (let x = 0; x <= n; x++) if (vec[x] < e[x]) e[x] = vec[x]
        }
        for (let x = n - 1; x >= 0; x--) if (e[x + 1] < e[x]) e[x] = e[x + 1]
        if (e.some((v) => v > 0)) pot = e
      }
      const cross: Crossing[] = []
      const c0 = from ? crossingOf(from.pending) : null
      if (c0) cross[0] = c0
      const rowsN: Float64Array[] = []
      const rowsF: Float64Array[] = []
      const minN: number[] = []
      const minF: number[] = []
      const junctions = Boolean(from || to || options.onJunction)
      const lockBoundary = options.lockBoundary ?? false
      return {
        n,
        from,
        to,
        startEdge: options.startEdge ?? (from ? EDGE_JUNCTION : EDGE_WORD),
        cross,
        pot,
        rowJ: junctions ? new Float64Array(n + 1) : null,
        coupleTarget: new Map(),
        maxDistance: options.maxDistance ?? 1,
        cutoff: options.cutoff ?? null,
        maxNormalized: options.maxNormalized ?? Infinity,
        norm: resolveNormalization(options.normalization ?? 'none'),
        onNode: options.onNode,
        onTerminal: options.onTerminal,
        onJunction: options.onJunction,
        initial: initialFrom
          ? {
              initials: initialFrom.initials,
              plan: planFor(x, initialFrom.from.row, junctions, lockBoundary),
              cross: crossingOf(initialFrom.from.pending),
              rowN: new Float64Array(n + 1),
              rowF: new Float64Array(n + 1),
              useF: false,
              minN: Infinity,
              minF: Infinity,
              lowerBound: Infinity,
            }
          : null,
        base0: null,
        bound0: Infinity,
        plan: planFor(x, from?.row ?? null, junctions, lockBoundary),
        rowsN,
        rowsF,
        bufF: [],
        minN,
        minF,
        rowAt: (r) => (useF(r) ? rowsF[r] : rowsN[r]),
        minAt: (r) => (useF(r) ? minF[r] : minN[r]),
        results: [],
      }
    })

    /**
     * 存活的通道：第 j 層的節點只計算 alive[j] 的前 aliveCount[j] 個通道（依通道編號遞增）。
     * 父節點算出下一層的清單後，所有子節點共用；前一個兄弟的子樹走完才會被覆寫，與 DP 的列相同，
     * 所以每層只需一份。以清單取代位元遮罩，通道數不再受 31 個的限制。
     */
    const alive: Int32Array[] = []
    const aliveCount: number[] = []
    const aliveAt = (j: number) => (alive[j] ??= new Int32Array(channels.length))

    /**
     * @param node 詞圖節點編號
     * @param j 深度
     * @param base 這個節點的子樹中，第一個詞的字典序名次
     */
    const visit = (node: number, j: number, base: number): void => {
      stats.visitedNodes++
      const isTerminal = dawg.isFinal(node)
      const firstEdge = dawg.firstEdge(node)
      const endEdge = dawg.endEdge(node)

      let hasBoundaryChild = false
      let hasOtherChild = false
      for (let e = firstEdge; e < endEdge; e++) {
        if (boundary[e] === 1) hasBoundaryChild = true
        else hasOtherChild = true
      }

      const current = alive[j]
      const next = aliveAt(j + 1)
      let nextCount = 0
      for (let a = 0; a < aliveCount[j]; a++) {
        const c = current[a]
        const ch = channels[c]
        const { n, plan, rowsN, rowsF, bufF, minN, minF } = ch
        // 跨界狀態：第 j 層由第 j − 1 層沿 Y[j-1] 往下走（只在還有狀態的淺層）。第 0 層的狀態是
        // 「在交界剛好結束」的 target，已經在前一段的交界列算過，所以只用在剪枝的下界
        let crossing: Crossing | null = null
        if (ch.cross.length) {
          if (j === 0) crossing = ch.cross[0]
          else {
            const prev = ch.cross[j - 1]
            if (prev && prev.count > 0) crossing = advanceCrossing(compiled, prev, matcher.ids[j - 1], (ch.cross[j] ??= createCrossing(ch.cross[0].nodes.length)))
            else if (ch.cross[j]) ch.cross[j].count = 0
          }
        }
        const column = prepareColumn(plan, compiled, matcher, j, ch.rowAt, ch.startEdge, j > 0 ? crossing : null)

        // N_j：子節點不是邊界字元時使用（fillRow 同時回傳這一列的最小值）
        const rowN = (rowsN[j] ??= new Float64Array(n + 1))
        minN[j] = fillRow(plan, compiled, column, false, rowN)
        if (ch.pot) minN[j] = minWithPotential(rowN, ch.pot)
        stats.computedRows++

        // F_j：只有「本節點是詞尾」或「有邊界字元的子節點」時才會被用到
        let rowF = rowN
        let rowFMin = minN[j]
        if (plan.hasFinal && (isTerminal || hasBoundaryChild)) {
          rowF = bufF[j] ??= new Float64Array(n + 1)
          rowFMin = fillRow(plan, compiled, column, true, rowF)
          if (ch.pot) rowFMin = minWithPotential(rowF, ch.pot)
          stats.computedRows++
        }
        rowsF[j] = rowF
        minF[j] = rowFMin

        // 此子樹允許的絕對距離上界
        let bound = ch.maxDistance
        if (Number.isFinite(ch.maxNormalized) && ch.norm.bound) {
          bound = Math.min(bound, ch.norm.bound(ch.maxNormalized, n, j + dawg.height[node]))
        }
        if (ch.cutoff) bound = Math.min(bound, ch.cutoff.best + ch.cutoff.spread)

        // 詞尾：記錄結果。base 就是這個詞的字典序名次（完美雜湊）
        let distance: number | null = null
        let accepted = false
        if (isTerminal) {
          let endAt = n
          // 交界列：這一段在這裡結束、後面接另一個詞素（詞尾與交界兩種規則都適用，X 的切點不在空白旁）
          const rowJ = ch.rowJ
          if (rowJ && (ch.onJunction || ch.to?.row || ch.to?.pending.length)) {
            fillRow(plan, compiled, column, EDGE_JUNCTION, rowJ)
            stats.computedRows++
          }
          if (ch.onJunction) ch.onJunction(path.slice(0, j).join(''), this._junctionState(ch, matcher, j, rowJ as Float64Array), payloads[base] ?? [])
          let exit: CoupleExit | undefined
          if (ch.to) {
            const coupled = this._couple(ch, matcher, j, rowF, rowJ as Float64Array)
            distance = roundCost(coupled.cost)
            endAt = coupled.exit.x
            exit = coupled.exit
          } else {
            distance = roundCost(rowF[n])
          }
          if (ch.onTerminal) ch.onTerminal(path.slice(0, j).join(''), rowF, payloads[base] ?? [])
          if (distance <= ch.maxDistance + EPSILON) {
            const score = roundCost(ch.norm.score(distance, n, j))
            if (score <= ch.maxNormalized + EPSILON) {
              accepted = true
              const result: SearchResult = { term: path.slice(0, j).join(''), distance, score, payloads: payloads[base] ?? [] }
              if (ch.to) {
                result.endAt = endAt
                result.exit = exit
              }
              ch.results.push(result)
              if (ch.cutoff && (!ch.cutoff.eligible || ch.cutoff.eligible(result.term))) {
                const total = ch.cutoff.termCost ? roundCost(distance + ch.cutoff.termCost(result.term)) : distance
                if (total < ch.cutoff.best) ch.cutoff.best = total
              }
            }
          }
        }

        // 剪枝：子樹內任何詞距離的下界（證明見檔頭）
        let lowerBound = Infinity
        if (hasOtherChild) lowerBound = minN[j]
        if (hasBoundaryChild) lowerBound = Math.min(lowerBound, minF[j])
        // 跨列：第 r 列經由一條更長的規則跳過第 j 列（狀態由 PathMatcher 提供，見 dp.ts）；
        // 跨界狀態同理，來源列在前一段
        lowerBound = Math.min(lowerBound, jumpBound(compiled, matcher, j, ch.minAt, crossing))
        // 以 initials 開頭的詞另有一套第 0 列：在根節點一起算好，子樹的下界取兩套中較小的
        if (j === 0 && ch.initial) {
          const a = ch.initial
          const col = prepareColumn(a.plan, compiled, matcher, 0, ch.rowAt, ch.startEdge, null)
          a.minN = fillRow(a.plan, compiled, col, false, a.rowN)
          if (ch.pot) a.minN = minWithPotential(a.rowN, ch.pot)
          a.useF = a.plan.hasFinal && (isTerminal || hasBoundaryChild)
          a.minF = a.minN
          if (a.useF) {
            a.minF = fillRow(a.plan, compiled, col, true, a.rowF)
            if (ch.pot) a.minF = minWithPotential(a.rowF, ch.pot)
          }
          stats.computedRows += a.useF ? 2 : 1
          let lb = Infinity
          if (hasOtherChild) lb = a.minN
          if (hasBoundaryChild) lb = Math.min(lb, a.minF)
          a.lowerBound = Math.min(lb, jumpBound(compiled, matcher, 0, () => Math.min(a.minN, a.minF), a.cross))
          ch.base0 = { rowN, rowF, minN: minN[0], minF: minF[0], cross: ch.cross[0] ?? null, lowerBound }
          ch.bound0 = bound
          lowerBound = Math.min(lowerBound, a.lowerBound)
        }
        const pruned = endEdge > firstEdge && lowerBound > bound + EPSILON

        if (ch.onNode) {
          ch.onNode({
            prefix: path.slice(0, j).join(''),
            depth: j,
            node,
            lowerBound: roundCost(lowerBound),
            bound: roundCost(bound),
            pruned,
            terminal: isTerminal,
            distance,
            accepted,
          })
        }
        if (!pruned) next[nextCount++] = c
      }

      if (nextCount === 0) {
        if (endEdge > firstEdge) stats.prunedNodes++
        return
      }
      aliveCount[j + 1] = nextCount
      // 依第一個字元換起點的通道（initialFrom）：在根節點的每條邊上換上對應的第 0 列，那一套的下界超過上限就不走
      const all = j === 0 && hasInitial ? next.slice(0, nextCount) : null
      for (let e = firstEdge; e < endEdge; e++) {
        path[j] = dawg.label(e)
        if (all) {
          let count = 0
          for (const c of all) {
            const ch = channels[c]
            if (ch.initial) {
              const a = ch.initial
              const base = ch.base0 as BaseRow
              const alt = a.initials.has(path[j])
              // 上限：根節點算的，再依途中收緊的相對上限（只會更緊）
              const bound = ch.cutoff ? Math.min(ch.bound0, ch.cutoff.best + ch.cutoff.spread) : ch.bound0
              if ((alt ? a.lowerBound : base.lowerBound) > bound + EPSILON) continue
              ch.rowsN[0] = alt ? a.rowN : base.rowN
              ch.rowsF[0] = alt ? (a.useF ? a.rowF : a.rowN) : base.rowF
              ch.minN[0] = alt ? a.minN : base.minN
              ch.minF[0] = alt ? a.minF : base.minF
              const cross = alt ? a.cross : base.cross
              if ((ch.cross[0] ?? null) !== cross) {
                // 更深層的跨界狀態由第 0 層推出、容量也依它配置，換了就重新配置
                ch.cross.length = 0
                if (cross) ch.cross[0] = cross
              }
            }
            next[count++] = c
          }
          if (count === 0) continue
          aliveCount[j + 1] = count
        }
        matcher.set(j + 1, codes[e])
        visit(dawg.target(e), j + 1, base + dawg.wordsBefore(e))
      }
      // path 超過 j 的部分留著不清：只以 path.slice(0, j) 讀取，下一個兄弟會覆寫 path[j]
    }

    const hasInitial = channels.some((ch) => ch.initial)
    const root = aliveAt(0)
    for (let c = 0; c < channels.length; c++) root[c] = c
    aliveCount[0] = channels.length
    try {
      visit(dawg.root, 0, 0)
    } finally {
      this._spareMatcher = matcher
    }
    return channels.map((c) => c.results)
  }

  /**
   * 這一段在深度 j 的詞尾結束時的交界狀態（複本）：交界列，加上路徑尾端還沒走完的規則 target。
   * 只收本段路徑上的狀態：一條規則至多跨越一個交界（docs/bcdp.md 1.3）。
   * @param rowJ 交界列
   */
  private _junctionState(ch: Channel, matcher: PathMatcher, j: number, rowJ: Float64Array): JunctionState {
    const compiled = matcher.compiled
    const pending: JunctionState['pending'] = []
    const base = j * matcher.cap
    for (let k = 0; k < matcher.counts[j]; k++) {
      const s = matcher.states[base + k]
      if (compiled.trieJump[s] === Infinity) continue // 沒有更長的 target 經過這裡
      pending.push({ node: s, row: Float64Array.from(ch.rowAt(j - compiled.trieDepth[s])) })
    }
    return { row: Float64Array.from(rowJ), pending }
  }

  /**
   * 詞尾與後一段（to）的耦合：整個詞的最小成本。
   * - to.word：這一段就是詞尾：min over x of F 列[x] ＋ word[x]
   * - 不跨界：min over x of 交界列[x] ＋ to.row[x]
   * - 跨界：規則 target ＝ 本段尾巴（路徑上的 trie 狀態 s）· 後一段的開頭（to.pending 的 tail），
   *   X 側 source 占 [i − |source|, i)：本段第 j − depth(s) 列 ＋ 權重 ＋ 後一段從 i 開始的成本
   */
  private _couple(ch: Channel, matcher: PathMatcher, j: number, rowF: Float64Array, rowJ: Float64Array): { cost: number; exit: CoupleExit } {
    const { n, plan } = ch
    const to = ch.to as JunctionEnd
    const compiled = matcher.compiled
    let cost = Infinity
    const exit: CoupleExit = { kind: 'word', x: -1, tail: -1 }
    if (to.word) {
      for (let x = 0; x <= n; x++) {
        const v = rowF[x] + to.word[x]
        if (v < cost) {
          cost = v
          exit.x = x
        }
      }
    }
    if (to.row) {
      for (let x = 0; x <= n; x++) {
        const v = rowJ[x] + to.row[x]
        if (v < cost) {
          cost = v
          exit.kind = 'row'
          exit.x = x
        }
      }
    }
    const tails = to.pending
    if (tails.length) {
      const base = j * matcher.cap
      for (let k = 0; k < matcher.counts[j]; k++) {
        const s = matcher.states[base + k]
        if (compiled.trieJump[s] === Infinity) continue
        const fromRow = ch.rowAt(j - compiled.trieDepth[s])
        for (let b = 0; b < tails.length; b++) {
          const key = s * tails.length + b
          let T = ch.coupleTarget.get(key)
          if (T === undefined) {
            const node = compiled.trieWalk(s, tails[b].tail)
            T = node === -1 ? -1 : compiled.trieTarget[node]
            ch.coupleTarget.set(key, T)
          }
          if (T === -1) continue
          const after = tails[b].row
          for (let p = plan.ruleOff[T]; p < plan.ruleOff[T + 1]; p++) {
            if (plan.ruleFlag[p] !== 0) continue // 跨越交界的只能是沒有位置限制的方言規則
            const i = plan.ruleI[p]
            const v = fromRow[i - plan.ruleSrc[p]] + plan.ruleW[p] + after[i]
            if (v < cost) {
              cost = v
              exit.kind = 'pending'
              exit.x = i
              exit.tail = b
            }
          }
        }
      }
    }
    return { cost, exit }
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

/** 交界狀態的跨界表 → 第 0 層的跨界狀態（沒有時是 null）。 */
function crossingOf(pending: JunctionState['pending']): Crossing | null {
  if (!pending.length) return null
  const c0 = createCrossing(pending.length)
  pending.forEach((p, k) => {
    c0.nodes[k] = p.node
    c0.rows[k] = p.row
    c0.mins[k] = Math.min(...p.row)
  })
  c0.count = pending.length
  return c0
}

/** 加上位能的列最小值：min_x（row[x] ＋ pot[x]）。 */
function minWithPotential(row: Float64Array, pot: Float64Array): number {
  let min = Infinity
  for (let x = 0; x < row.length; x++) {
    const v = row[x] + pot[x]
    if (v < min) min = v
  }
  return min
}
