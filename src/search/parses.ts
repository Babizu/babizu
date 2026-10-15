/**
 * @file 拆解表：詞庫中每個詞的所有拆法（句型搜尋的構詞樣式用，docs/pattern-query.md 第 4 節）。
 *
 * 一般搜尋查 w 時，「自動拆解」列出 BCDP 找到的每個詞根與它的拆法；拆解表就是建置時對每個詞先算好的這一串：
 * - 每個候選詞根取最好的那一種分析，範圍在「最好的 ＋ lemmaSpread」之內、總成本 ≤ DERIVATION_MAX_COST；
 * - 詞根比 w 短、是單一個詞（不含空白）；
 * - 加上自動派生圖中 w 的虛擬詞根（詞庫外的共同詞根，derivations.ts 的條件）。
 *
 * 建置時與自動派生圖是同一次 BCDP（derivations.ts 的 analyzeAll），自動派生圖只取其中最好的。
 * 「最好」兩邊都以 BCDP 在詞庫中最好的命中為準（lexicalBestOf）：最好的命中不是拆法時（例如 abak 最好的命中是
 * a- ＋ barak，詞根比詞長，只有成本高得多的 rak 比它短），自動派生圖不建邊，拆解表另外記下那個命中的成本（best），
 * 依模糊程度取拆法時也從它算起，這種詞就不會把巧合的拆法當成最好的。所以拆解表中與最好的命中同分的詞庫詞根，
 * 就是自動派生圖這個詞的邊。虛擬詞根的拆法是另外一種，成本不與詞庫拆法比較（與自動派生圖相同：虛擬詞根只補充，不取代）。
 *
 * 只拆一層，不沿詞根再往下拆：BCDP 一次分析就能剝掉好幾個詞綴（maxSteps），多層的詞多半直接拆得到；
 * 再往下疊只會多出巧合。
 *
 * ## parses.json
 * 編碼與 derivations.json 相同（derivations.ts 的 encodeEdges），只是不存音變說明（需要時現算）：
 * ```
 * { version, count, virtual: [詞幹…], steps: [MorphStepHit…], analyses: [[cost, [步驟編號…], []]…], edges: [Δw, r, a, …],
 *   best: [Δw, 成本, Δw, 成本, …] }
 * ```
 * - 每個詞的拆法依成本排序（同分依詞根），虛擬詞根的拆法接在後面；
 * - `best`：BCDP 最好的命中不是拆法的詞（詞根不比詞短、或含空白）與那個命中的成本，兩個一組，存與上一組的詞編號差。
 */

import { roundCost, type LanguageProfile, type MorphStepHit, type SerializedIndex } from '#bcdp'
import { createDerivationAnalyzer, encodeEdges, mergeEdges, type DerivationData, type DerivationEdge } from './derivations.ts'

/** parses.json 的格式版本 */
export const PARSES_FORMAT_VERSION = 1

/** 一個詞的一種拆法 */
export interface ParsedAnalysis {
  /** 詞根（詞庫中的詞，或虛擬詞根） */
  root: string
  /** 詞根是虛擬詞根（不在詞庫中） */
  virtual: boolean
  /** 總成本：構詞步驟＋整個詞的音變＋詞根音節數的成本 */
  cost: number
  /** 整個詞的音變（成本扣掉各步驟的成本與詞根音節數的成本；構詞音變算在步驟裡） */
  sound: number
  /** 詞根依音節數的成本（rootSyllableCost；0 時省略） */
  rootCost?: number
  /** 由外而內 */
  steps: MorphStepHit[]
}

/** parses.json 的內容 */
export type ParseData = DerivationData & { best: number[] }

/**
 * 拆解表的內容（parses.json）：第 1 階段的拆法加上虛擬詞根的邊。
 * @param parses analyzeAll 的 parses（依詞編號排序）
 * @param virtual 虛擬詞根的邊（依詞編號排序）
 * @param bests analyzeAll 的 bests（依詞編號排序）
 * @param count 詞圖的詞數
 */
export function encodeParses(parses: DerivationEdge[], virtual: DerivationEdge[], bests: Array<[number, number]>, count: number): ParseData {
  const data = encodeEdges(
    mergeEdges(
      parses,
      virtual.map((e) => ({ ...e, analysis: { ...e.analysis, notes: [] } })),
    ),
    count,
    PARSES_FORMAT_VERSION,
  )
  const best: number[] = []
  let prev = 0
  for (const [word, cost] of bests) {
    best.push(word - prev, cost)
    prev = word
  }
  return { ...data, best }
}

/**
 * 一種拆法（拆解表與句型搜尋分析詞庫外的詞共用，音變的算法才會一致）。
 * @param rootCost 詞根依音節數的成本（不是音變）
 */
export function parsedAnalysis(root: string, virtual: boolean, cost: number, steps: MorphStepHit[], rootCost = 0): ParsedAnalysis {
  const sound = Math.max(0, roundCost(cost - steps.reduce((sum, x) => sum + x.cost, 0) - rootCost))
  return { root, virtual, cost, sound, steps, ...(rootCost > 0 ? { rootCost } : {}) }
}

/** 依成本排序（同分保持原本的順序：詞庫詞根在前、依詞根，接著是虛擬詞根）。 */
export function sortParses(list: ParsedAnalysis[]): ParsedAnalysis[] {
  return list
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.cost - b.p.cost || a.i - b.i)
    .map((x) => x.p)
}

/** 建立拆解表（單執行緒；測試與評估工具用，網站建置另有平行版本，src/site/derivations.ts）。 */
export function buildParseChart({ lexicon, profile }: { lexicon: SerializedIndex; profile: LanguageProfile }): ParseData {
  const analyzer = createDerivationAnalyzer({ lexicon, profile })
  const { edges, parses, bests } = analyzer.analyzeAll()
  return encodeParses(parses, analyzer.virtual(edges), bests, analyzer.count)
}

/** 查詢端的拆解表：依詞編號取這個詞的所有拆法（第一次用到時解碼，之後快取）。 */
export class ParseChart {
  readonly data: ParseData
  readonly terms: string[]
  readonly rootCost: (root: string) => number
  /** 虛擬詞根 → 節點編號（詞庫中的詞之後） */
  readonly virtualIds: Map<string, number>
  /** 詞 → 它的第一條邊在 edges 中的位置（邊依詞排序，同一個詞的邊相連） */
  private _first = new Map<number, number>()
  /** 詞 → BCDP 最好的命中的成本（那個命中不是拆法的詞才有） */
  private _best = new Map<number, number>()
  private _cache = new Map<number, ParsedAnalysis[]>()

  /**
   * @param terms 詞圖的所有詞（詞編號＝索引）
   * @param rootCost 詞庫詞根依音節數的成本（構詞搜尋的 rootCost）：拆法的成本含它，音變扣掉它
   */
  constructor(data: ParseData, terms: string[], rootCost: (root: string) => number = () => 0) {
    if (data.version !== PARSES_FORMAT_VERSION) {
      throw new Error(`拆解表格式版本 ${data.version} 與框架（${PARSES_FORMAT_VERSION}）不符，請重新建置網站`)
    }
    if (data.count !== terms.length) throw new Error(`拆解表的詞數（${data.count}）與詞圖（${terms.length}）不符，請重新建置網站`)
    this.data = data
    this.terms = terms
    this.rootCost = rootCost
    this.virtualIds = new Map(data.virtual.map((v, k) => [v, terms.length + k]))
    const e = data.edges
    for (let k = 0, word = 0; k + 2 < e.length; k += 3) {
      word += e[k]
      if (!this._first.has(word)) this._first.set(word, k)
    }
    for (let k = 0, word = 0; k + 1 < data.best.length; k += 2) {
      word += data.best[k]
      this._best.set(word, data.best[k + 1])
    }
  }

  /**
   * BCDP 在詞庫中最好的命中的成本：最好的詞庫拆法，或最好的命中不是拆法時的那個命中
   * （例如 abak 最好的命中是 a- ＋ barak，詞根比詞長），取較低的；沒有任何命中時是 Infinity。
   * 自動派生圖這個詞的邊，就是成本等於它的詞庫拆法；依模糊程度取詞庫拆法時也從它算起（pattern/morph.ts 的 selectParses）。
   * **不含虛擬詞根**：虛擬詞根的成本是精確列舉的步驟成本，與 BCDP 的成本不能比（混在一起時虛擬詞根會把詞庫拆法擠掉）。
   */
  lexicalBestOf(word: number): number {
    return Math.min(this._best.get(word) ?? Infinity, ...this.of(word).filter((p) => !p.virtual).map((p) => p.cost))
  }

  /**
   * 詞的所有拆法，依成本排序（同分保持原本的順序：詞庫詞根依詞根，接著是虛擬詞根）。
   * @param word 詞編號
   */
  of(word: number): ParsedAnalysis[] {
    let list = this._cache.get(word)
    if (list) return list
    list = []
    const { edges, analyses, steps, virtual } = this.data
    const count = this.terms.length
    const start = this._first.get(word)
    for (let k = start ?? edges.length; k + 2 < edges.length; k += 3) {
      // 同一個詞的邊與上一條的差是 0；差不是 0 就是下一個詞了
      if (k > (start as number) && edges[k] !== 0) break
      const r = edges[k + 1]
      const [cost, ids] = analyses[edges[k + 2]]
      const root = r >= count ? virtual[r - count] : this.terms[r]
      list.push(parsedAnalysis(root, r >= count, cost, ids.map((id) => steps[id]), r >= count ? 0 : this.rootCost(root)))
    }
    list = sortParses(list)
    this._cache.set(word, list)
    return list
  }
}
