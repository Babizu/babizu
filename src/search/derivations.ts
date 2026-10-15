/**
 * @file 自動派生圖：查詞根時找到演算法推定的加綴變化（自動派生，docs/bcdp.md 第 10 節）。
 * 這是演算法推定的關係；辭典標註的派生關係在 docs.parent 與詞根 posting，兩者分開計算、分開標示。
 *
 * 建置時以構詞搜尋 BCDP 對詞庫中每個詞 w（含例句中的詞）求**成本最低的詞根** r（同分的都取），
 * 詞根必須比 w 短（以字元計），記一條邊 w → r，附上 BCDP 對 w 的分析。查詢時由查詢（與它的相近寫法）
 * 沿反向的邊往下走，派生詞的派生詞也走得到：查 sungut 得到 pausunguday（p<a>u-…-ay，一個組合規則）。
 *
 * - 兩個方向一致：「查 r 看到 w」等於「查 w 時 r 是最好的詞根」，每條邊都是 BCDP 算出來的，
 *   不需要另一套演算法。
 * - 沒有循環：邊一定由較短的詞根指向較長的詞，所以依長度由短到長鬆弛一遍就是最短路徑，走訪一定停止。
 * - 只取最好的詞根、允許遞移：比收下所有詞根雜訊少得多，召回幾乎一樣。
 *
 * ## 虛擬詞根：詞庫中沒有的共同詞根（演算法在 BCDP 套件的 virtual-roots.ts）
 * 詞根不在詞庫中時，在詞圖上走訪找不到它：查 binubuer（b<in>ubuer）找不到 mabubuer（ma-bubuer），
 * 因為兩者共同的詞根 bubuer 不是任何記錄的詞形。所以同一個 BCDP 也求「詞庫外的詞根」（`virtualRoots`，docs/bcdp.md 10.5）：
 * - **字面**：詞根是詞中原樣的一段（BCDP 的 openStems，成本直接由交界列讀出），分析中的詞綴也必須原樣出現，
 *   只容許構詞音變（只有構詞音變的距離函式，createAlternationMetric）。不在詞庫裡的部分不能再加模糊，
 *   否則會發明詞根（abuk → a- ＋ rabuk）與同根；
 * - **長度懲罰**（借用最小描述長度的直覺，但每個詞各自計算、拼寫成本不分攤，不是標準的 MDL；docs/bcdp.md 10.5）：
 *   詞庫中的詞根只要指出是哪一個，詞庫外的要逐字寫出來，所以分析的分數是
 *   成本 ＋ `virtualRootLengthCost` × 詞根長度（`virtualRootCost`）。分數比 BCDP 在詞庫中最好的詞根的成本低才成立
 *   （原本的邊一條都不動，只在詞庫解釋不了的地方補上），取分數最低的（同分的都取）。長的詞庫外詞根常常是沒有認出的組合
 *   （pinahazab ＝ pina- ＋ hazap），自然輸給詞庫的分析；分數相同的拆法取剝得最乾淨的（maa- ＋ exet~ ＋ exet，不是 exetexet）；
 * - **形狀像一個詞根**（`isVirtualRootShape`）：至少兩個元音、比 minStem 長，太短的詞幹容易巧合相同；
 * - **w 本身不是別的詞的詞根**：自動派生圖中有詞以 w 為最好的詞根，或辭典標明某詞 < w 時，w 就是根，
 *   不再往上拆（samian 是 masamian、musamian 的詞根，不拆成 sa- ＋ mian）。所以要知道所有詞庫詞根的邊：
 *   候選與詞庫詞根的邊在第 1 階段一起（平行）算，第 2 階段只用這個條件過濾。
 * 查詢時以**同一個函式、同樣的條件**拆查詢本身（`virtualRoots`，詞庫中最好的詞根用同一個定義 `lexicalEdgeCost`）：
 * masamian 的自動拆解是 ma- ＋ samian，詞庫已經解釋得了，不再拆成 masa- ＋ mian。拆出的虛擬詞根往下走，
 * 找到的是與查詢推定同一個詞根的詞（命中方式 sibling，介面標「自動同根」）。虛擬詞根本身不是結果。
 *
 * ## 拆解表 parses.json（句型搜尋用，見 parses.ts）
 * 建圖時對每個詞跑的那一次 BCDP，本來就算出了所有候選詞根（每個詞根取最好的分析，在「最好的 ＋ lemmaSpread」之內），
 * 自動派生圖只取最好的。`analyzeAll` 把其餘的也收下（詞根比詞短、不含空白），所以拆解表幾乎不多花時間；
 * BCDP 最好的命中不是拆法時另外記下它的成本（bests）。拆解表中與最好的命中同分的詞庫詞根，就是自動派生圖這個詞的邊。
 *
 * ## derivations.json
 * ```
 * { version, count, virtual: [詞幹…], steps: [MorphStepHit…], analyses: [[cost, [步驟編號…], [音變…]]…], edges: [Δw, r, a, Δw, r, a, …] }
 * ```
 * - `count`：詞圖的詞數（詞編號＝詞圖的字典序名次，與 lexicon.json 同一份）
 * - `virtual`：虛擬詞根（依字典序）；邊的詞根編號 r ≥ count 時指 virtual[r − count]
 * - `steps`：去重的構詞步驟（含語法說明）；詞綴只有幾十種，每個步驟只存一次
 * - `analyses`：去重的分析：成本（步驟成本＋音變）、步驟編號（由外而內）、音變說明
 *   （每一個寫成 [op, source, target, cost, category, where]）
 * - `edges`：三個一組，詞 w（與上一條邊的差；邊依 w 排序）、詞根 r、分析編號 a
 */

import {
  createMorphSearch,
  DERIVATION_MAX_COST,
  EPSILON,
  FuzzyIndex,
  lexicalEdgeCost,
  roundCost,
  soundOf,
  virtualRoots,
  type Analyzer,
  type LanguageProfile,
  type MorphSearch,
  type MorphStepHit,
  type SerializedIndex,
  type SoundNote,
  type VirtualRoot,
} from '#bcdp'
import { decodePosting } from './format.ts'
import { createTextTools, type TextTools } from './text.ts'

// 虛擬詞根的演算法在 BCDP 套件（packages/bcdp/src/virtual-roots.ts）；這裡轉匯出，babizu/search 的 API 不變
export { DERIVATION_MAX_COST, isVirtualRootShape, lexicalEdgeCost, soundOf, virtualRootCost, virtualRoots } from '#bcdp'

/** derivations.json 的格式版本（2：加上虛擬詞根） */
export const DERIVATIONS_FORMAT_VERSION = 2

/**
 * 詞庫詞根的自動同根：兩條邊（查詢 → 詞根、詞根 → 同根詞）的音變上限（成本扣掉步驟成本）。
 * 與句型搜尋取拆法的音變上限（pattern/morph.ts 的 PARSE_SELECTION，精確與標準）相同：音變多的拆法多半是巧合，
 * 兩條巧合的邊接起來更不可靠（短的詞根 lat 收了 alasay、balas 這類巧合的子詞）
 */
export const SIBLING_MAX_SOUND = 0.2

/** 一條邊的分析：w 由 r 加上這些步驟而來 */
export interface DerivationAnalysis {
  /** 步驟成本＋整個詞的音變 */
  cost: number
  /** 由外而內 */
  steps: MorphStepHit[]
  notes: SoundNote[]
}

/** derivations.json 的內容 */
export interface DerivationData {
  version: number
  count: number
  /** 虛擬詞根 */
  virtual: string[]
  steps: MorphStepHit[]
  analyses: Array<[number, number[], Array<[string, string, string, number, string | null, string]>]>
  edges: number[]
}

/** 一條邊；root 是詞庫中的詞根（詞編號）或虛擬詞根（詞幹字串） */
export interface DerivationEdge {
  word: number
  root: number | string
  analysis: DerivationAnalysis
}

/** 由某個起點走到的自動派生形 */
export interface DerivedReach {
  /** 詞編號（一定是詞庫中的詞） */
  word: number
  /** 總分：起點距離＋路徑上各條邊的成本 */
  cost: number
  /** 起點在 seeds 中的位置 */
  seed: number
  /** 由起點往下的每一條邊（最後一條進入 word） */
  path: Array<{ word: number; root: number; analysis: DerivationAnalysis }>
}

/**
 * 詞庫中的詞是不是辭典的詞條或標為詞根（rootSyllableCost 的 entry）：有任何一種不是例句中的詞（token）的 posting——
 * 記錄的詞形、異寫、變體，或衍生詞標註的詞根。只出現在例句、片語中的詞不算。
 */
export function entryTest(index: FuzzyIndex): (term: string) => boolean {
  const memo = new Map<number, boolean>()
  return (term) => {
    const id = index.dawg.lookup(term)
    if (id === -1) return false
    let v = memo.get(id)
    if (v === undefined) memo.set(id, (v = ((index.payloads[id] ?? []) as number[]).some((code) => decodePosting(code).kind !== 'token')))
    return v
  }
}

/**
 * 虛擬詞根用的構詞搜尋：只有構詞音變的距離函式上的 BCDP（詞綴必須原樣出現；詞根由 openStems 給）。
 * @param index 詞庫（虛擬詞根不能是詞庫中的詞）
 */
export function createVirtualRootSearch(text: TextTools, index: FuzzyIndex): MorphSearch {
  return createMorphSearch({ analyzer: text.morphology as Analyzer, metric: text.createAlternationMetric(), index, isEntry: entryTest(index) })
}

/** 一個詞的 BCDP 分析（analyzeWord 的結果） */
export interface WordAnalysis {
  /** 自動派生圖的邊（BCDP 成本最低的詞庫詞根，同分全收，詞根比詞短） */
  edges: Array<{ root: number; analysis: DerivationAnalysis }>
  /** 拆解表（每個候選詞根，詞根比詞短、是單一個詞） */
  parses: Array<{ root: number; analysis: DerivationAnalysis }>
  /** BCDP 最好的命中不是拆法時（詞根不比詞短或含空白）那個命中的成本，否則 null */
  best: number | null
  /** 虛擬詞根（virtualRoots，詞庫中最好的詞根取 edges 的成本；還沒過濾「詞本身不是根」） */
  virtual: VirtualRoot[]
}

/**
 * 建立「求最好的詞根」的分析器，分兩個階段：
 * 1. `analyze(from, to)`：詞庫中編號在 [from, to) 的詞，BCDP 在詞庫中最好的詞根（每個詞各自算，可以切塊平行執行，
 *    src/site/derivations.ts；各塊的結果依詞編號接起來，與一次算完相同）。`analyzeAll` 另外收下拆解表與虛擬詞根的候選；
 * 2. `virtual(edges, candidates)`：拿第 1 階段全部的邊，過濾虛擬詞根的候選（詞本身是別的詞的詞根時不往上拆，
 *    要知道全部的邊）。沒有候選時這裡現算（單執行緒）。
 */
export function createDerivationAnalyzer({ lexicon, profile }: { lexicon: SerializedIndex; profile: LanguageProfile }) {
  const text = createTextTools(profile)
  const metric = text.createSearchMetric()
  const index = FuzzyIndex.deserialize(lexicon, metric)
  const analyzer = text.morphology
  const search = analyzer ? createMorphSearch({ analyzer, metric, index, isEntry: entryTest(index) }) : null
  const open = analyzer ? createVirtualRootSearch(text, index) : null
  return {
    /** 詞圖的詞數 */
    count: index.size,
    /** @returns 依詞編號排序 */
    analyze: (from = 0, to = Infinity): DerivationEdge[] => (search ? analyzeRange(index, search, null, from, to).edges : []),
    /**
     * 同 analyze，另外收下拆解表的分析（每個候選詞根一個，見 parses.ts）與虛擬詞根的候選（還沒過濾條件「詞本身不是根」）。
     * 都依詞編號排序；bests 是 BCDP 最好的命中不是拆法的詞（詞根不比詞短或含空白）與那個命中的成本（parses.ts 的 best）
     */
    analyzeAll: (from = 0, to = Infinity): RangeAnalysis => (search ? analyzeRange(index, search, open, from, to) : { edges: [], parses: [], bests: [], virtual: [] }),
    /**
     * @param edges 第 1 階段全部的邊
     * @param candidates 第 1 階段的虛擬詞根候選（analyzeAll 的 virtual）；省略時現算
     * @returns 虛擬詞根的邊，依詞編號排序
     */
    virtual: (edges: DerivationEdge[], candidates?: DerivationEdge[]): DerivationEdge[] => (open ? virtualEdges(index, open, edges, candidates) : []),
  }
}

/** 一段詞的分析結果（analyzeAll） */
export interface RangeAnalysis {
  edges: DerivationEdge[]
  parses: DerivationEdge[]
  bests: Array<[number, number]>
  virtual: DerivationEdge[]
}

/** 詞 w（詞編號 id）是不是根：自動派生圖中有詞以它為最好的詞根，或辭典標明某詞由它衍生（詞根 posting）。 */
export function isLexicalRoot(index: FuzzyIndex, id: number, hasChildren: (id: number) => boolean): boolean {
  if (id < 0) return false
  if (hasChildren(id)) return true
  return ((index.payloads[id] ?? []) as number[]).some((code) => decodePosting(code).kind === 'root')
}

/**
 * 第 2 階段：虛擬詞根的邊（條件見檔頭）。候選（第 1 階段，每個詞各自算）只差「詞本身不是別的詞的詞根」這個條件，
 * 它要知道全部的邊，在這裡過濾。沒有給候選時現算。
 * @param open 虛擬詞根用的構詞搜尋（createVirtualRootSearch）
 * @param edges 詞庫詞根的邊
 */
function virtualEdges(index: FuzzyIndex, open: MorphSearch, edges: DerivationEdge[], candidates?: DerivationEdge[]): DerivationEdge[] {
  /** 是別的詞的詞根的詞 */
  const roots = new Set<number>()
  for (const e of edges) if (typeof e.root === 'number') roots.add(e.root)
  if (!candidates) {
    /** 詞 → 詞庫中最好的詞根的成本 */
    const best = new Map<number, number>()
    for (const e of edges) if (typeof e.root === 'number') best.set(e.word, Math.min(best.get(e.word) ?? Infinity, e.analysis.cost))
    candidates = index.terms.flatMap((w, word) => virtualCandidates(w, word, open, index, best.get(word) ?? Infinity))
  }
  return candidates.filter((e) => !isLexicalRoot(index, e.word, (id) => roots.has(id)))
}

/** 一個詞的虛擬詞根寫成邊（還沒過濾「詞本身不是根」） */
function virtualCandidates(w: string, word: number, open: MorphSearch, index: FuzzyIndex, lexiconBest: number): DerivationEdge[] {
  return virtualRoots(w, open, index, lexiconBest).map((v) => ({ word, root: v.stem, analysis: { cost: v.cost, steps: v.steps, notes: v.notes } }))
}

/** 兩個階段的邊合在一起，依詞編號排序（同一個詞的邊保持原本的順序：詞庫詞根在前）。 */
export function mergeEdges(lexical: DerivationEdge[], virtual: DerivationEdge[]): DerivationEdge[] {
  return [...lexical, ...virtual].map((e, k) => ({ e, k })).sort((a, b) => a.e.word - b.e.word || a.k - b.k).map((x) => x.e)
}

/** @param open 虛擬詞根用的構詞搜尋（null：不求虛擬詞根） */
function analyzeRange(index: FuzzyIndex, search: MorphSearch, open: MorphSearch | null, from: number, to: number): RangeAnalysis {
  const terms = index.terms
  /** 自動派生圖的邊 */
  const edges: DerivationEdge[] = []
  /** 拆解表 */
  const parses: DerivationEdge[] = []
  /** 拆解表：BCDP 最好的命中不是拆法（詞根不比詞短或含空白）的詞，與那個命中的成本 */
  const bests: Array<[number, number]> = []
  /** 虛擬詞根的候選 */
  const virtual: DerivationEdge[] = []
  for (let word = from; word < Math.min(to, terms.length); word++) {
    const a = analyzeWord(terms[word], index, search, true, open)
    for (const e of a.edges) edges.push({ word, ...e })
    for (const p of a.parses) parses.push({ word, ...p })
    for (const v of a.virtual) virtual.push({ word, root: v.stem, analysis: { cost: v.cost, steps: v.steps, notes: v.notes } })
    if (a.best !== null) bests.push([word, a.best])
  }
  return { edges, parses, bests, virtual }
}

/**
 * 一個詞的 BCDP 分析。建置自動派生圖與拆解表（analyzeRange），以及句型搜尋分析詞庫外的詞
 * （例句體例展開的讀法，pattern/search.ts 的 _unlistedParses）都用這個函式，所以兩邊的結果一定相同。
 * @param withNotes 自動派生圖的邊附上音變說明（句型搜尋不需要）
 * @param open 虛擬詞根用的構詞搜尋（createVirtualRootSearch；省略時不求虛擬詞根）
 */
export function analyzeWord(w: string, index: FuzzyIndex, search: MorphSearch, withNotes = true, open: MorphSearch | null = null): WordAnalysis {
  const length = Array.from(w).length
  const edges: WordAnalysis['edges'] = []
  const parses: WordAnalysis['parses'] = []
  const prepared = search.prepare(w, DERIVATION_MAX_COST)
  const hits = prepared ? search.finish(prepared, index.searchChannels(search.seed(prepared).channels), DERIVATION_MAX_COST) : []
  const best = hits.length && (Array.from(hits[0].term).length >= length || hits[0].term.includes(' ')) ? roundCost(hits[0].distance) : null
  for (const hit of hits) {
    if (Array.from(hit.term).length >= length) continue
    const root = index.dawg.lookup(hit.term)
    // 拆解表：每個候選詞根（詞根比詞短、是單一個詞），不存音變說明（需要時現算）。
    // 同一個詞根成本相同的其他讀法也收（hit.ties：元音開頭的詞根上 a- 與 <a>），句型搜尋才比得到每一種
    if (!hit.term.includes(' ')) {
      for (const steps of [hit.steps, ...(hit.ties ?? [])]) parses.push({ root, analysis: { cost: roundCost(hit.distance), steps, notes: [] } })
    }
    // 自動派生圖：BCDP 成本最低的詞庫詞根（同分全收），詞根比詞短
    if (hit.distance > hits[0].distance + EPSILON) continue
    const notes = withNotes && prepared ? search.notesOf(prepared, hit) : []
    edges.push({ root, analysis: { cost: roundCost(hit.distance), steps: hit.steps, notes } })
  }
  const virtual = open ? virtualRoots(w, open, index, lexicalEdgeCost(w, hits)) : []
  return { edges, parses, best, virtual }
}

/**
 * 把 analyze 的結果（依詞編號排序）寫成 derivations.json 的內容（分析去重；虛擬詞根依字典序編號）。
 * @param count 詞圖的詞數
 */
export function encodeDerivations(edges: DerivationEdge[], count: number): DerivationData {
  return encodeEdges(edges, count, DERIVATIONS_FORMAT_VERSION)
}

/**
 * 邊（依詞編號排序）的編碼，derivations.json 與 parses.json 共用（格式見檔頭）。
 * @param count 詞圖的詞數
 */
export function encodeEdges(edges: DerivationEdge[], count: number, version: number): DerivationData {
  const virtual = [...new Set(edges.flatMap((e) => (typeof e.root === 'string' ? [e.root] : [])))].sort()
  const virtualIds = new Map(virtual.map((v, k) => [v, count + k]))
  /** 去重：同樣內容的物件只存一次，回傳它的編號 */
  const intern = <T>(table: T[], ids: Map<string, number>, value: T) => {
    const key = JSON.stringify(value)
    let k = ids.get(key)
    if (k === undefined) {
      k = table.length
      ids.set(key, k)
      table.push(value)
    }
    return k
  }
  const steps: DerivationData['steps'] = []
  const analyses: DerivationData['analyses'] = []
  const stepIds = new Map<string, number>()
  const analysisIds = new Map<string, number>()
  const flat: number[] = []
  let prev = 0
  for (const { word, root, analysis } of edges) {
    const encoded: DerivationData['analyses'][number] = [
      analysis.cost,
      analysis.steps.map((st) => intern(steps, stepIds, st)),
      analysis.notes.map((n) => [n.op, n.source, n.target, n.cost, n.category, n.where]),
    ]
    flat.push(word - prev, typeof root === 'string' ? (virtualIds.get(root) as number) : root, intern(analyses, analysisIds, encoded))
    prev = word
  }
  return { version, count, virtual, steps, analyses, edges: flat }
}

/** 建立自動派生圖（單執行緒；測試與評估工具用，網站建置另有平行版本）。 */
export function buildDerivationGraph({ lexicon, profile }: { lexicon: SerializedIndex; profile: LanguageProfile }): DerivationData {
  const analyzer = createDerivationAnalyzer({ lexicon, profile })
  const lexical = analyzer.analyze()
  return encodeDerivations(mergeEdges(lexical, analyzer.virtual(lexical)), analyzer.count)
}

/**
 * 查詢端：自動派生圖（詞根 → 衍生詞）。節點編號：詞庫中的詞是 0…count−1，虛擬詞根接在後面。
 * 虛擬詞根只有往下的邊（它不是任何詞的衍生詞），只能當起點。
 */
export class DerivationGraph {
  readonly analyses: DerivationAnalysis[]
  readonly terms: string[]
  /** 節點（詞根）依音節數的成本：詞庫中的詞才有，虛擬詞根是 0 */
  readonly rootCostOf: (id: number) => number
  /** 所有節點的寫法：詞庫中的詞，接著是虛擬詞根 */
  readonly nodes: string[]
  /** 虛擬詞根 → 節點編號 */
  readonly virtualIds: Map<string, number>
  /** 詞根 → 由它衍生的詞 */
  readonly children = new Map<number, Array<{ word: number; analysis: number }>>()
  private _length = new Map<number, number>()

  /**
   * @param terms 詞圖的所有詞（詞編號＝索引）
   * @param rootCost 詞庫詞根依音節數的成本（構詞搜尋的 rootCost）：邊的成本含它，算音變時扣掉
   */
  constructor(data: DerivationData, terms: string[], rootCost: (root: string) => number = () => 0) {
    if (data.version !== DERIVATIONS_FORMAT_VERSION) {
      throw new Error(`自動派生圖格式版本 ${data.version} 與框架（${DERIVATIONS_FORMAT_VERSION}）不符，請重新建置網站`)
    }
    if (data.count !== terms.length) throw new Error(`自動派生圖的詞數（${data.count}）與詞圖（${terms.length}）不符，請重新建置網站`)
    this.analyses = data.analyses.map(([cost, steps, notes]) => ({
      cost,
      steps: steps.map((k) => data.steps[k]),
      notes: notes.map(([op, source, target, c, category, where]) => ({ op, source, target, cost: c, category, where: where as SoundNote['where'] })),
    }))
    this.terms = terms
    this.rootCostOf = (id) => (id < terms.length ? rootCost(terms[id]) : 0)
    this.nodes = [...terms, ...(data.virtual ?? [])]
    this.virtualIds = new Map((data.virtual ?? []).map((v, k) => [v, terms.length + k]))
    const e = data.edges
    for (let k = 0, word = 0; k + 2 < e.length; k += 3) {
      word += e[k]
      let list = this.children.get(e[k + 1])
      if (!list) this.children.set(e[k + 1], (list = []))
      list.push({ word, analysis: e[k + 2] })
    }
  }

  private _len(id: number): number {
    let n = this._length.get(id)
    if (n === undefined) this._length.set(id, (n = Array.from(this.nodes[id]).length))
    return n
  }

  /** 節點是不是虛擬詞根 */
  isVirtual(id: number): boolean {
    return id >= this.terms.length
  }

  /** 有沒有詞以這個節點為詞根 */
  hasChildren(id: number): boolean {
    return (this.children.get(id)?.length ?? 0) > 0
  }

  /**
   * 起點的直接子詞（以起點為最好詞根的詞），只取音變不超過 maxSound 的邊；起點距離加上邊的成本不超過 maxPath。
   * 同一個詞由幾個起點走到時取總分最小的。詞庫詞根的自動同根用：同根就是同一個詞根的直接子詞，不含孫輩。
   * @param seeds distance 含查詢拆到這個詞根的詞根成本時，rootCost 記下它（上限不算）
   * @returns 依總分排序（同分依詞編號），不含起點本身
   */
  childrenOf(seeds: Array<{ id: number; distance: number; rootCost?: number }>, { maxPath, maxSound }: { maxPath: number; maxSound: number }): DerivedReach[] {
    const best = new Map<number, DerivedReach>()
    const seedIds = new Set(seeds.map((s) => s.id))
    seeds.forEach((s, k) => {
      for (const c of this.children.get(s.id) ?? []) {
        const analysis = this.analyses[c.analysis]
        const cost = roundCost(s.distance + analysis.cost)
        // 上限比不含詞根成本的成本：這條邊的與起點（查詢拆到這個詞根）的詞根成本都扣掉
        const capped = cost - this.rootCostOf(s.id) - (s.rootCost ?? 0)
        if (seedIds.has(c.word) || soundOf(analysis, this.rootCostOf(s.id)) > maxSound + EPSILON || capped > maxPath + EPSILON) continue
        const prev = best.get(c.word)
        if (!prev || cost < prev.cost - EPSILON) best.set(c.word, { word: c.word, cost, seed: k, path: [{ word: c.word, root: s.id, analysis }] })
      }
    })
    return [...best.values()].sort((a, b) => a.cost - b.cost || a.word - b.word)
  }

  /**
   * 由起點往下找所有自動派生形，每個詞取總分最小的路徑；路徑本身的成本（不含起點距離）不超過 maxPath。
   *
   * 邊一定由短的詞指向長的詞，所以詞長由短到長就是拓撲順序：依這個順序鬆弛一遍就是最短路徑（DAG 最短路徑）。
   *
   * @param seeds 起點（詞編號）與它和查詢的距離
   * @returns 依總分排序（同分依詞編號），不含起點本身
   */
  descendants(seeds: Array<{ id: number; distance: number }>, maxPath: number = DERIVATION_MAX_COST): DerivedReach[] {
    // 1. 找出走得到的詞（路徑成本各自不超過上限，先寬鬆收集）
    const reach = new Set<number>()
    const stack = seeds.map((s) => s.id)
    while (stack.length) {
      const x = stack.pop() as number
      for (const c of this.children.get(x) ?? []) {
        // 上限比不含詞根成本的成本（詞根成本只改名次，docs/bcdp.md 1.6 第 9 項）
        if (this.analyses[c.analysis].cost - this.rootCostOf(x) > maxPath + EPSILON || reach.has(c.word)) continue
        reach.add(c.word)
        stack.push(c.word)
      }
    }
    // 2. 依詞長（拓撲順序）鬆弛
    const best = new Map<number, { cost: number; path: number; seed: number; from: number; analysis: number }>()
    seeds.forEach((s, k) => {
      const prev = best.get(s.id)
      if (!prev || s.distance < prev.cost) best.set(s.id, { cost: s.distance, path: 0, seed: k, from: -1, analysis: -1 })
    })
    const order = [...new Set([...seeds.map((s) => s.id), ...reach])].sort((a, b) => this._len(a) - this._len(b) || a - b)
    for (const x of order) {
      const at = best.get(x)
      if (!at) continue
      for (const c of this.children.get(x) ?? []) {
        const edge = this.analyses[c.analysis].cost
        // path 是比上限用的路徑成本：不含詞根成本；cost 是排名用的，含它
        const path = at.path + edge - this.rootCostOf(x)
        if (path > maxPath + EPSILON) continue
        const cost = roundCost(at.cost + edge)
        const prev = best.get(c.word)
        if (!prev || cost < prev.cost - EPSILON || (Math.abs(cost - prev.cost) <= EPSILON && path < prev.path - EPSILON)) {
          best.set(c.word, { cost, path: roundCost(path), seed: at.seed, from: x, analysis: c.analysis })
        }
      }
    }
    // 3. 起點本身不算；還原每個詞的路徑
    const seedIds = new Set(seeds.map((s) => s.id))
    const out: DerivedReach[] = []
    for (const [word, b] of best) {
      if (seedIds.has(word)) continue
      const path: DerivedReach['path'] = []
      for (let x = word, at = b; at.from !== -1; x = at.from, at = best.get(at.from) as typeof b) {
        path.unshift({ word: x, root: at.from, analysis: this.analyses[at.analysis] })
      }
      out.push({ word, cost: b.cost, seed: b.seed, path })
    }
    return out.sort((a, b) => a.cost - b.cost || a.word - b.word)
  }
}
