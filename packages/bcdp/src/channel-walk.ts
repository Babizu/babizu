/**
 * @file 詞圖的多通道走訪：FuzzyIndex.searchChannels 的本體——深度優先走訪詞圖、逐列 DP、剪枝。
 *
 * 走到深度 j 的節點，就代表候選字串 Y 的前 j 個字元已確定，這時算出 DP 的第 j 列。共用前綴的詞共用上層的列，
 * 不必重算。多個通道（各自的查詢與邊界條件）在同一次走訪中各算各的列；某個通道在一個節點被剪掉，
 * 只是它不再往下算，所有通道都剪掉時才停止往下走。
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
 * - 詞圖的邊標籤預先轉成字元編號（FuzzyIndex 的 `_edgeCodes`，每個索引、每組規則只算一次），
 *   並預先標出哪些邊是邊界字元，走訪時不再做字串比較。
 * - 路徑上的規則 target 匹配與跨列剪枝改由 `PathMatcher` 逐層維護（見 dp.ts 檔頭第 3 點）。
 *   它只依賴路徑、與通道無關，所以每個節點只算一次，所有通道共用。
 * - 列的最小值由 `fillRow` 順便回傳。
 */

import type { Dawg } from './dawg.ts'
import {
  advanceCrossing,
  createCrossing,
  crossingFrom,
  EDGE_JUNCTION,
  EDGE_WORD,
  EPSILON,
  fillRow,
  jumpBound,
  prepareColumn,
  roundCost,
  type ColumnContext,
  type CompiledRules,
  type Crossing,
  type PathMatcher,
  type QueryPlan,
} from './dp.ts'
import { requireCost } from './guards.ts'
import type { CoupleExit, SearchOptions, SearchResult, SearchStats, SpreadCutoff } from './fuzzy-index.ts'
import type { JunctionEnd, JunctionState } from './junction.ts'
import { resolveNormalization, type NormalizationStrategy } from './score-normalization.ts'

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
export interface Channel {
  n: number
  from: JunctionState | null
  to: JunctionEnd | null
  startEdge: number
  /** 第 j 層的跨界狀態（來自 from.pending，只在淺層） */
  cross: Crossing[]
  /** 詞尾耦合的位能（見 createChannel）；處處是 0 時為 null */
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

/**
 * 查詢端的編譯：依（查詢、交界、鎖住空白）共用，通道之間只差在起點列
 * @param start 第 0 列的起點成本（null：只有 D(0, 0) ＝ 0）
 */
export type PlanFor = (x: string[], start: Float64Array | null, junctions: boolean, lockBoundary: boolean) => QueryPlan

/**
 * 建立一個通道：檢查邊界條件，算好詞尾耦合的位能與第 0 層的跨界狀態。
 * @param x 已正規化的查詢
 * @param useF 第 r 列（r < 目前深度）是否該用 F 列（看路徑上第 r 個字元是否為邊界；所有通道共用）
 */
export function createChannel(x: string[], options: SearchOptions, planFor: PlanFor, useF: (r: number) => boolean): Channel {
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
  const c0 = from ? crossingFrom(from.pending) : null
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
          cross: crossingFrom(initialFrom.from.pending),
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
}

/** 一次走訪共用的狀態 */
export interface Walk {
  compiled: CompiledRules
  dawg: Dawg
  /** 依詞的字典序名次排列的附帶資料 */
  payloads: unknown[][]
  /** 詞圖每條邊的字元編號與邊界旗標 */
  codes: Int32Array
  boundary: Uint8Array
  /** 路徑上的字元編號、邊界旗標與規則 target 的 trie 狀態（所有通道共用） */
  matcher: PathMatcher
  /** 目前走訪路徑上的字元（只在組出結果的詞時使用；超過目前深度的部分不清，以 path.slice(0, j) 讀取） */
  path: string[]
  stats: SearchStats
  channels: Channel[]
  /**
   * 存活的通道：第 j 層的節點只計算 alive[j] 的前 aliveCount[j] 個通道（依通道編號遞增）。
   * 父節點算出下一層的清單後，所有子節點共用；前一個兄弟的子樹走完才會被覆寫，與 DP 的列相同，
   * 所以每層只需一份。以清單取代位元遮罩，通道數不受限制。
   */
  alive: Int32Array[]
  aliveCount: number[]
  /** 有沒有依第一個字元換起點的通道（initialFrom） */
  hasInitial: boolean
}

/** 由詞圖的根開始走訪，所有通道一起。 */
export function walk(w: Walk): void {
  const root = aliveAt(w, 0)
  for (let c = 0; c < w.channels.length; c++) root[c] = c
  w.aliveCount[0] = w.channels.length
  visit(w, w.dawg.root, 0, 0)
}

const aliveAt = (w: Walk, j: number) => (w.alive[j] ??= new Int32Array(w.channels.length))

/**
 * @param node 詞圖節點編號
 * @param j 深度
 * @param base 這個節點的子樹中，第一個詞的字典序名次
 */
function visit(w: Walk, node: number, j: number, base: number): void {
  const { dawg, boundary, channels, alive, aliveCount } = w
  w.stats.visitedNodes++
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
  const next = aliveAt(w, j + 1)
  let nextCount = 0
  for (let a = 0; a < aliveCount[j]; a++) {
    const c = current[a]
    const pruned = stepChannel(w, channels[c], node, j, base, isTerminal, hasBoundaryChild, hasOtherChild, firstEdge, endEdge)
    if (!pruned) next[nextCount++] = c
  }

  if (nextCount === 0) {
    if (endEdge > firstEdge) w.stats.prunedNodes++
    return
  }
  aliveCount[j + 1] = nextCount
  descend(w, j, base, firstEdge, endEdge, next, nextCount)
}

/**
 * 一個通道在一個節點上的計算：第 j 列（N 列，必要時加 F 列）、詞尾的結果、子樹的下界。
 * @returns 這個通道是否在此剪枝（子樹不再往下算）
 */
function stepChannel(
  w: Walk,
  ch: Channel,
  node: number,
  j: number,
  base: number,
  isTerminal: boolean,
  hasBoundaryChild: boolean,
  hasOtherChild: boolean,
  firstEdge: number,
  endEdge: number,
): boolean {
  const { compiled, matcher, stats, dawg, path } = w
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

  const { distance, accepted } = isTerminal ? terminal(w, ch, j, base, column, rowF) : NOT_TERMINAL

  // 剪枝：子樹內任何詞距離的下界（證明見檔頭）
  let lowerBound = Infinity
  if (hasOtherChild) lowerBound = minN[j]
  if (hasBoundaryChild) lowerBound = Math.min(lowerBound, minF[j])
  // 跨列：第 r 列經由一條更長的規則跳過第 j 列（狀態由 PathMatcher 提供，見 dp.ts）；
  // 跨界狀態同理，來源列在前一段
  lowerBound = Math.min(lowerBound, jumpBound(compiled, matcher, j, ch.minAt, crossing))
  // 以 initials 開頭的詞另有一套第 0 列：在根節點一起算好，子樹的下界取兩套中較小的
  if (j === 0 && ch.initial) {
    ch.base0 = { rowN, rowF, minN: minN[0], minF: minF[0], cross: ch.cross[0] ?? null, lowerBound }
    ch.bound0 = bound
    lowerBound = Math.min(lowerBound, initialRoot(w, ch, ch.initial, isTerminal, hasBoundaryChild, hasOtherChild))
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
  return pruned
}

const NOT_TERMINAL = { distance: null, accepted: false } as const

/**
 * 走到詞尾：算交界列、回報交界狀態、與後一段耦合，符合門檻就記下結果並收緊相對上限。
 * base 就是這個詞的字典序名次（完美雜湊）。
 */
function terminal(w: Walk, ch: Channel, j: number, base: number, column: ColumnContext, rowF: Float64Array): { distance: number; accepted: boolean } {
  const { compiled, matcher, stats, path, payloads } = w
  const { n, plan } = ch
  let endAt = n
  // 交界列：這一段在這裡結束、後面接另一個詞素（詞尾與交界兩種規則都適用，X 的切點不在空白旁）
  const rowJ = ch.rowJ
  if (rowJ && (ch.onJunction || ch.to?.row || ch.to?.pending.length)) {
    fillRow(plan, compiled, column, EDGE_JUNCTION, rowJ)
    stats.computedRows++
  }
  if (ch.onJunction) ch.onJunction(path.slice(0, j).join(''), junctionState(ch, matcher, j, rowJ as Float64Array), payloads[base] ?? [])
  let exit: CoupleExit | undefined
  let distance: number
  if (ch.to) {
    const coupled = couple(ch, matcher, j, rowF, rowJ as Float64Array)
    distance = roundCost(coupled.cost)
    endAt = coupled.exit.x
    exit = coupled.exit
  } else {
    distance = roundCost(rowF[n])
  }
  if (ch.onTerminal) ch.onTerminal(path.slice(0, j).join(''), rowF, payloads[base] ?? [])
  let accepted = false
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
  return { distance, accepted }
}

/**
 * 根節點上，以 initials 開頭的詞的那一套第 0 列（initialFrom）：算好兩種列與由它出發的子樹下界。
 * @returns 那一套的子樹下界
 */
function initialRoot(w: Walk, ch: Channel, a: InitialRow, isTerminal: boolean, hasBoundaryChild: boolean, hasOtherChild: boolean): number {
  const { compiled, matcher, stats } = w
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
  return a.lowerBound
}

/**
 * 沿著每條出邊往下走訪（存活的通道已寫在 alive[j + 1]）。
 * 在根節點上，依第一個字元換起點的通道（initialFrom）在每條邊上換上對應的第 0 列，那一套的下界超過上限就不走。
 */
function descend(w: Walk, j: number, base: number, firstEdge: number, endEdge: number, next: Int32Array, nextCount: number): void {
  const { dawg, channels, aliveCount, path, matcher, codes } = w
  const all = j === 0 && w.hasInitial ? next.slice(0, nextCount) : null
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
    visit(w, dawg.target(e), j + 1, base + dawg.wordsBefore(e))
  }
}

/**
 * 這一段在深度 j 的詞尾結束時的交界狀態（複本）：交界列，加上路徑尾端還沒走完的規則 target。
 * 只收本段路徑上的狀態：一條規則至多跨越一個交界（docs/bcdp.md 1.3）。
 * @param rowJ 交界列
 */
function junctionState(ch: Channel, matcher: PathMatcher, j: number, rowJ: Float64Array): JunctionState {
  const depth = matcher.compiled.trieDepth
  const pending = matcher.openStates(j).map((s) => ({ node: s, row: Float64Array.from(ch.rowAt(j - depth[s])) }))
  return { row: Float64Array.from(rowJ), pending }
}

/**
 * 詞尾與後一段（to）的耦合：整個詞的最小成本。
 * - to.word：這一段就是詞尾：min over x of F 列[x] ＋ word[x]
 * - 不跨界：min over x of 交界列[x] ＋ to.row[x]
 * - 跨界：規則 target ＝ 本段尾巴（路徑上的 trie 狀態 s）· 後一段的開頭（to.pending 的 tail），
 *   X 側 source 占 [i − |source|, i)：本段第 j − depth(s) 列 ＋ 權重 ＋ 後一段從 i 開始的成本
 * 每個詞尾都會呼叫：跨界的部分直接走訪匹配器的狀態，不另外配置陣列。
 */
function couple(ch: Channel, matcher: PathMatcher, j: number, rowF: Float64Array, rowJ: Float64Array): { cost: number; exit: CoupleExit } {
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

/** 加上位能的列最小值：min_x（row[x] ＋ pot[x]）。 */
function minWithPotential(row: Float64Array, pot: Float64Array): number {
  let min = Infinity
  for (let x = 0; x < row.length; x++) {
    const v = row[x] + pot[x]
    if (v < min) min = v
  }
  return min
}
