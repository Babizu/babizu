/**
 * @file 自動派生與自動同根（查詞根、找衍生詞）：由查詢與它的相近寫法沿自動派生圖往下走（derivations.ts）。
 *
 * 圖的每一條邊是建置時 BCDP 對那個詞求得的最好詞根，所以「查 r 看到 w」等於「查 w 時自動拆解最好的詞根是 r」，
 * 派生詞的派生詞也走得到。分數是起點距離加上路徑上各條邊的成本；路徑本身的成本不超過自動拆解方向的上限
 * （fuzziness.ts 的 lemmaMax：同一個模糊程度，兩個方向的上限相同）。
 */

import { EPSILON, roundCost, type FuzzyIndex, type MorphSearch } from '#bcdp'
import {
  isLexicalRoot,
  lexicalEdgeCost,
  SIBLING_MAX_SOUND,
  soundOf,
  virtualRootCost,
  virtualRoots,
  type DerivationGraph,
  type DerivedReach,
} from './derivations.ts'
import type { AlignmentNote, LemmaAnalysis, MorphNote, SiblingSplit, TermMatch } from './types.ts'

/** 自動派生的起點 */
interface DerivationSeed {
  /** 自動派生圖的節點 */
  id: number
  /** 與查詢的距離（自動同根時含拆解的成本） */
  distance: number
  term: string
  /** 查詢拆到這個詞根時的詞根成本（上限不算它） */
  rootCost?: number
  /** 自動同根：查詢怎麼拆到這個詞根 */
  split?: SiblingSplit
}

export interface DerivedTermsDeps {
  index: FuzzyIndex
  /** 自動派生圖；沒有時不找自動派生形（find 回傳空陣列） */
  graph: DerivationGraph | null
  /** 虛擬詞根用的構詞搜尋（搜尋引擎的 virtualRootSearch，第一次用到時才建立） */
  virtualRootSearch: () => MorphSearch | null
  /** 兩個詞的對齊說明（搜尋引擎的 explainNotes） */
  explainNotes: (query: string, term: string) => AlignmentNote[]
}

export class DerivedTerms {
  private readonly index: FuzzyIndex
  private readonly graph: DerivationGraph | null
  private readonly virtualRootSearch: () => MorphSearch | null
  private readonly explainNotes: (query: string, term: string) => AlignmentNote[]

  constructor({ index, graph, virtualRootSearch, explainNotes }: DerivedTermsDeps) {
    this.index = index
    this.graph = graph
    this.virtualRootSearch = virtualRootSearch
    this.explainNotes = explainNotes
  }

  /**
   * 自動派生（matchType derived）與自動同根（sibling）的命中。
   *
   * 自動同根：先往上到查詢的詞根，再往下走。詞根有兩種，都以建置時同一個定義取得：
   * - 詞庫中的詞根：自動拆解最好的詞庫詞根（同分全收，比查詢短、單一個詞；與自動派生圖的邊同一個定義）。
   *   只取它的直接子詞（同一個詞根，不含孫輩），兩條邊的音變都不超過 SIBLING_MAX_SOUND：
   *   詞庫的詞根常有幾十個派生詞，兩條巧合的邊接起來尤其不可靠；
   *   查詢本身也是別的詞的詞根時照樣往上：自動派生圖上它也有詞庫詞根的邊（派生詞的派生詞），
   *   同一個詞根的其他子詞查它時找得到它，查它時也要找得到它們（不往上的話，同根對常常只有一個方向找得到）；
   * - 虛擬詞根：以建置時同一個函式、同樣的條件拆查詢本身（queryVirtualRoots），起點的距離另加詞庫外詞根的代價
   *   virtualRootCost。查詢本身是別的詞的詞根時不拆（與建置時的條件相同：samian 不拆成 sa- ＋ 虛擬詞根 mian）。
   *
   * 分三次走，後面的只補上前面沒走到的詞：先由查詢與它的相近寫法（與沒有自動同根時完全相同），
   * 再由詞庫中的詞根，最後由虛擬詞根（把握最小）。
   *
   * @param key 查詢的搜尋鍵
   * @param variants 查詢的相近寫法（模糊命中的詞）
   * @param maxPath 路徑成本的上限
   * @param lemma 自動拆解的命中（BCDP 的全部命中，含詞根不比查詢短的）
   */
  find(key: string, variants: TermMatch[], maxPath: number, lemma: TermMatch[] = []): TermMatch[] {
    const graph = this.graph
    if (!graph) return []
    const seeds: DerivationSeed[] = []
    for (const s of [{ term: key, distance: 0 }, ...variants]) {
      const id = this.index.dawg.lookup(s.term)
      if (id !== -1) seeds.push({ id, distance: s.distance, term: s.term })
    }
    const self = this.index.dawg.lookup(key)
    const lemmaBest = Math.min(Infinity, ...lemma.map((m) => m.distance))
    const lexicalSeeds: DerivationSeed[] = []
    const virtualSeeds: DerivationSeed[] = []
    // 詞庫中的詞根：與自動派生圖的邊同一個定義（BCDP 最好的命中中，詞根比查詢短、單一個詞的）
    const length = Array.from(key).length
    for (const m of lemma) {
      if (m.distance > lemmaBest + EPSILON || m.term.includes(' ') || Array.from(m.term).length >= length || !m.analysis) continue
      if (soundOf({ cost: m.distance, steps: m.analysis.steps }, m.analysis.rootCost ?? 0) > SIBLING_MAX_SOUND + EPSILON) continue
      const id = this.index.dawg.lookup(m.term)
      const rootCost = m.analysis.rootCost ?? 0
      if (id !== -1) lexicalSeeds.push({ id, distance: m.distance, rootCost, term: m.term, split: { cost: m.distance, steps: m.analysis.steps, penalty: 0, lexical: true, rootCost } })
    }
    // 虛擬詞根：查詢本身是別的詞的詞根時不拆（與建置時相同）
    if (!isLexicalRoot(this.index, self, (id) => graph.hasChildren(id))) {
      const open = this.virtualRootSearch() as MorphSearch
      for (const v of this.queryVirtualRoots(key, lemma)) {
        const id = graph.virtualIds.get(v.stem)
        const penalty = virtualRootCost(v.stem, open.spec)
        if (id !== undefined) {
          const rootCost = open.syllableCost(v.stem, false)
          virtualSeeds.push({ id, distance: roundCost(v.cost + penalty), term: v.stem, split: { cost: v.cost, steps: v.steps, penalty, lexical: false, rootCost } })
        }
      }
    }
    // 自動同根不取代其他命中（scoring.ts 的 mergeMorphMatch），在圖上也一樣：只補上前面沒走到的詞
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
          .filter((r) => !reached.has(r.word) && r.word !== self && r.cost - (r.from.split?.penalty ?? 0) - r.path.reduce((x, e) => x + graph.rootCostOf(e.root), 0) <= maxPath + EPSILON)
      : []
    /** 查詢 → 起點的對齊說明（每個起點算一次） */
    const variantNotes = new Map<string, AlignmentNote[]>()
    const out: TermMatch[] = []
    for (const r of [...direct, ...viaLexical, ...viaVirtual]) {
      const seed = r.from
      const analysis = this.reachAnalysis(key, r, seed, r.cost, variantNotes)
      out.push({
        term: this.index.terms[r.word],
        payloads: this.index.payloads[r.word],
        distance: r.cost,
        matchType: seed.split ? 'sibling' : 'derived',
        analysis,
      })
    }
    return out
  }

  /**
   * 查詢的虛擬詞根：與建置時同一個函式（virtualRoots）、同一個「詞庫中最好的詞根」的定義（lexicalEdgeCost：
   * BCDP 最好的命中有詞根比查詢短的才算，否則是 Infinity），所以詞庫中的詞拆出的就是建置時它的虛擬詞根邊。
   * @param lemma 自動拆解的命中（BCDP 的全部命中）
   * @returns 語言設定檔沒有構詞規格時是空陣列
   */
  queryVirtualRoots(key: string, lemma: TermMatch[]) {
    const open = this.virtualRootSearch()
    return open ? virtualRoots(key, open, this.index, lexicalEdgeCost(key, lemma)) : []
  }

  /**
   * 自動派生圖上一條路徑的分析（LemmaAnalysis）：最後一層是 stem、steps，上面幾層在 chain；
   * 起點是查詢的相近寫法時記下 variantOf（說明「由相近寫法出發」），經過虛擬詞根時記下 sibling。
   * @param key 查詢
   * @param r 路徑
   * @param seed 起點
   * @param cost 總分（起點距離＋路徑成本，經過虛擬詞根時另加代價）
   * @param variantNotes 查詢 → 起點的對齊說明（同一次搜尋共用）
   */
  private reachAnalysis(key: string, r: DerivedReach, seed: DerivationSeed, cost: number, variantNotes: Map<string, AlignmentNote[]>): LemmaAnalysis {
    const graph = this.graph as DerivationGraph
    const nodes = graph.nodes
    const last = r.path[r.path.length - 1]
    const lastRootCost = graph.rootCostOf(last.root)
    const analysis: LemmaAnalysis = {
      stem: nodes[last.root],
      steps: last.analysis.steps,
      cost,
      ...(lastRootCost > 0 ? { rootCost: lastRootCost } : {}),
      notes: last.analysis.notes as MorphNote[],
      ...(r.path.length > 1
        ? {
            chain: r.path.slice(0, -1).map((e) => {
              const rc = graph.rootCostOf(e.root)
              return { term: nodes[e.word], stem: nodes[e.root], steps: e.analysis.steps, cost: e.analysis.cost, ...(rc > 0 ? { rootCost: rc } : {}) }
            }),
          }
        : {}),
    }
    if (seed.split) {
      // 自動同根：查詢拆出的詞根就是這個詞往上的詞根（詞庫中的詞，或詞庫中沒有的虛擬詞根）
      const { steps, cost, penalty, lexical, rootCost } = seed.split
      analysis.sibling = { root: seed.term, steps, cost, penalty, lexical, ...(rootCost ? { rootCost } : {}) }
    } else if (seed.distance > 0) {
      analysis.variantOf = key
      analysis.variantDistance = seed.distance
      if (!variantNotes.has(seed.term)) variantNotes.set(seed.term, this.explainNotes(key, seed.term))
      analysis.variantNotes = variantNotes.get(seed.term)
    }
    return analysis
  }
}
