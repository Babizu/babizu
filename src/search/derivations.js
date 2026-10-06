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
 * - 只取最好的詞根、允許遞移：比收下所有詞根雜訊少得多，召回幾乎一樣（研究紀錄的評估）。
 *
 * ## 虛擬詞根：詞庫中沒有的共同詞根
 * 詞根不在詞庫中時，在詞圖上走訪找不到它：查 binubuer（b<in>ubuer）找不到 mabubuer（ma-bubuer），
 * 因為兩者共同的詞根 bubuer 不是任何記錄的詞形。所以同一個 BCDP 也求「詞庫外的詞根」（`virtualRoots`，docs/bcdp.md 10.5）：
 * - **字面**：詞根是詞中原樣的一段（morph-search.js 的 openStems，成本直接由交界列讀出），分析中的詞綴也必須原樣出現，
 *   只容許構詞音變（只有構詞音變的距離函式，text.js 的 createAlternationMetric）。不在詞庫裡的部分不能再加模糊，
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
 * ## 拆解表 parses.json（句型搜尋用，見 parses.js）
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

import { rootCostOf } from '../fuzzy/morphology.js'
import { createMorphSearch, EPSILON, FuzzyIndex, roundCost } from '../fuzzy/index.js'
import { decodePosting } from './format.js'
import { createTextTools } from './text.js'

/** derivations.json 的格式版本（2：加上虛擬詞根） */
export const DERIVATIONS_FORMAT_VERSION = 2

/** 一條邊的分析成本上限（與自動拆解方向的上限 LEMMA_MAX_DISTANCE 相同） */
export const DERIVATION_MAX_COST = 1

/**
 * 詞庫詞根的自動同根：兩條邊（查詢 → 詞根、詞根 → 同根詞）的音變上限（成本扣掉步驟成本）。
 * 與句型搜尋取拆法的音變上限（pattern/morph.js 的 PARSE_SELECTION，精確與標準）相同：音變多的拆法多半是巧合，
 * 兩條巧合的邊接起來更不可靠（短的詞根 lat 收了 alasay、balas 這類巧合的子詞）
 */
export const SIBLING_MAX_SOUND = 0.2

/**
 * 一個分析的音變（成本扣掉步驟成本與詞根音節數的成本）
 * @param {{cost: number, steps: Array<{cost: number}>}} a
 * @param {number} [rootCost] 詞根依音節數的成本（rootSyllableCost；不是音變）
 */
export const soundOf = (a, rootCost = 0) => Math.max(0, roundCost(a.cost - a.steps.reduce((x, s) => x + s.cost, 0) - rootCost))

/**
 * 詞庫中的詞是不是辭典的詞條或標為詞根（rootSyllableCost 的 entry）：有任何一種不是例句中的詞（token）的 posting——
 * 記錄的詞形、異寫、變體，或衍生詞標註的詞根。只出現在例句、片語中的詞不算。
 * @param {FuzzyIndex} index
 * @returns {(term: string) => boolean}
 */
export function entryTest(index) {
  /** @type {Map<number, boolean>} */
  const memo = new Map()
  return (term) => {
    const id = index.dawg.lookup(term)
    if (id === -1) return false
    let v = memo.get(id)
    if (v === undefined) memo.set(id, (v = /** @type {number[]} */ (index.payloads[id] ?? []).some((code) => decodePosting(code).kind !== 'token')))
    return v
  }
}

/**
 * 經過虛擬詞根的代價（長度懲罰）：詞庫中沒有這個詞根，要逐字寫出來，每個字元 `virtualRootLengthCost`；
 * 語言設定檔有 rootSyllableCost 時另加音節數的成本（虛擬詞根不是辭典的詞條，用 other）。
 * 每個用到它的詞各付一次（不在共用的詞之間分攤）。
 * 建置時虛擬詞根的分析加上它仍比詞庫中最好的詞根便宜才成立；查詢時經過虛擬詞根的命中加上一次
 * （查詢 → 虛擬詞根 → 詞，只算一次）。
 * @param {string} stem
 * @param {{virtualRootLengthCost: number, rootSyllableCost: {entry: readonly number[], other: readonly number[]}, vowels: string}} spec 構詞規格（分析器的 spec）
 */
export function virtualRootCost(stem, spec) {
  return roundCost(spec.virtualRootLengthCost * Array.from(stem).length + rootCostOf(spec)(stem, false))
}

/**
 * 虛擬詞根用的構詞搜尋：只有構詞音變的距離函式上的 BCDP（詞綴必須原樣出現；詞根由 openStems 給）。
 * @param {import('./text.js').TextTools} text
 * @param {FuzzyIndex} index 詞庫（虛擬詞根不能是詞庫中的詞）
 */
export function createVirtualRootSearch(text, index) {
  return createMorphSearch({ analyzer: /** @type {import('../fuzzy/morphology.js').Analyzer} */ (text.morphology), metric: text.createAlternationMetric(), index, isEntry: entryTest(index) })
}

/**
 * 詞幹的形狀像不像一個詞根（虛擬詞根的條件）：比 minStem 長，而且至少兩個元音。
 * 巴宰語 karaw、kuraw、paraw 都拆得出 raw，但那只是巧合相同的一個音節。
 * @param {string} stem
 * @param {{minStem: number, vowels: string}} spec 構詞規格（分析器的 spec；vowels 是元音字母）
 */
export function isVirtualRootShape(stem, spec) {
  const chars = Array.from(stem)
  return chars.length > spec.minStem && chars.filter((c) => spec.vowels.includes(c)).length >= 2
}

/**
 * @typedef {object} DerivationAnalysis 一條邊的分析：w 由 r 加上這些步驟而來
 * @property {number} cost 步驟成本＋整個詞的音變
 * @property {import('../fuzzy/morph-search.js').MorphStepHit[]} steps 由外而內
 * @property {Array<{op: string, source: string, target: string, cost: number, category: string | null, where: string}>} notes
 */

/**
 * @typedef {object} DerivationData derivations.json 的內容
 * @property {number} version
 * @property {number} count
 * @property {string[]} virtual 虛擬詞根
 * @property {import('../fuzzy/morph-search.js').MorphStepHit[]} steps
 * @property {Array<[number, number[], Array<[string, string, string, number, string | null, string]>]>} analyses
 * @property {number[]} edges
 */

/**
 * @typedef {{word: number, root: number | string, analysis: DerivationAnalysis}} DerivationEdge
 *   一條邊；root 是詞庫中的詞根（詞編號）或虛擬詞根（詞幹字串）
 */

/**
 * 建立「求最好的詞根」的分析器，分兩個階段：
 * 1. `analyze(from, to)`：詞庫中編號在 [from, to) 的詞，BCDP 在詞庫中最好的詞根（每個詞各自算，可以切塊平行執行，
 *    src/site/derivations.js；各塊的結果依詞編號接起來，與一次算完相同）。`analyzeAll` 另外收下拆解表與虛擬詞根的候選；
 * 2. `virtual(edges, candidates)`：拿第 1 階段全部的邊，過濾虛擬詞根的候選（詞本身是別的詞的詞根時不往上拆，
 *    要知道全部的邊）。沒有候選時這裡現算（單執行緒）。
 * @param {{lexicon: import('../fuzzy/fuzzy-index.js').SerializedIndex, profile: import('../fuzzy/profile.js').LanguageProfile}} input
 */
export function createDerivationAnalyzer({ lexicon, profile }) {
  const text = createTextTools(profile)
  const metric = text.createSearchMetric()
  const index = FuzzyIndex.deserialize(lexicon, metric)
  const analyzer = text.morphology
  const search = analyzer ? createMorphSearch({ analyzer, metric, index, isEntry: entryTest(index) }) : null
  const open = analyzer ? createVirtualRootSearch(text, index) : null
  return {
    /** 詞圖的詞數 */
    count: index.size,
    /**
     * @param {number} [from]
     * @param {number} [to]
     * @returns {DerivationEdge[]} 依詞編號排序
     */
    analyze: (from = 0, to = Infinity) => (search ? analyzeRange(index, search, null, from, to).edges : []),
    /**
     * 同 analyze，另外收下拆解表的分析（每個候選詞根一個，見 parses.js）與虛擬詞根的候選（還沒過濾條件「詞本身不是根」）。
     * @param {number} [from]
     * @param {number} [to]
     * @returns {{edges: DerivationEdge[], parses: DerivationEdge[], bests: Array<[number, number]>, virtual: DerivationEdge[]}} 都依詞編號排序；
     *   bests 是 BCDP 最好的命中不是拆法的詞（詞根不比詞短或含空白）與那個命中的成本（parses.js 的 best）
     */
    analyzeAll: (from = 0, to = Infinity) => (search ? analyzeRange(index, search, open, from, to) : { edges: [], parses: [], bests: [], virtual: [] }),
    /**
     * @param {DerivationEdge[]} edges 第 1 階段全部的邊
     * @param {DerivationEdge[]} [candidates] 第 1 階段的虛擬詞根候選（analyzeAll 的 virtual）；省略時現算
     * @returns {DerivationEdge[]} 虛擬詞根的邊，依詞編號排序
     */
    virtual: (edges, candidates) => (open ? virtualEdges(index, open, edges, candidates) : []),
  }
}

/**
 * 詞 w（詞編號 id）是不是根：自動派生圖中有詞以它為最好的詞根，或辭典標明某詞由它衍生（詞根 posting）。
 * @param {FuzzyIndex} index
 * @param {number} id
 * @param {(id: number) => boolean} hasChildren
 */
export function isLexicalRoot(index, id, hasChildren) {
  if (id < 0) return false
  if (hasChildren(id)) return true
  return /** @type {number[]} */ (index.payloads[id] ?? []).some((code) => decodePosting(code).kind === 'root')
}

/**
 * 第 2 階段：虛擬詞根的邊（條件見檔頭）。候選（第 1 階段，每個詞各自算）只差「詞本身不是別的詞的詞根」這個條件，
 * 它要知道全部的邊，在這裡過濾。沒有給候選時現算。
 * @param {FuzzyIndex} index
 * @param {ReturnType<typeof createMorphSearch>} open 虛擬詞根用的構詞搜尋（createVirtualRootSearch）
 * @param {DerivationEdge[]} edges 詞庫詞根的邊
 * @param {DerivationEdge[]} [candidates]
 * @returns {DerivationEdge[]}
 */
function virtualEdges(index, open, edges, candidates) {
  /** @type {Set<number>} 是別的詞的詞根的詞 */
  const roots = new Set()
  for (const e of edges) if (typeof e.root === 'number') roots.add(e.root)
  if (!candidates) {
    /** @type {Map<number, number>} 詞 → 詞庫中最好的詞根的成本 */
    const best = new Map()
    for (const e of edges) if (typeof e.root === 'number') best.set(e.word, Math.min(best.get(e.word) ?? Infinity, e.analysis.cost))
    candidates = index.terms.flatMap((w, word) => virtualCandidates(w, word, open, index, best.get(word) ?? Infinity))
  }
  return candidates.filter((e) => !isLexicalRoot(index, e.word, (id) => roots.has(id)))
}

/**
 * 一個詞的虛擬詞根寫成邊（還沒過濾「詞本身不是根」）
 * @param {string} w @param {number} word @param {ReturnType<typeof createMorphSearch>} open @param {FuzzyIndex} index @param {number} lexiconBest
 * @returns {DerivationEdge[]}
 */
function virtualCandidates(w, word, open, index, lexiconBest) {
  return virtualRoots(w, open, index, lexiconBest).map((v) => ({ word, root: v.stem, analysis: { cost: v.cost, steps: v.steps, notes: v.notes } }))
}

/**
 * 兩個階段的邊合在一起，依詞編號排序（同一個詞的邊保持原本的順序：詞庫詞根在前）。
 * @param {DerivationEdge[]} lexical
 * @param {DerivationEdge[]} virtual
 */
export function mergeEdges(lexical, virtual) {
  return [...lexical, ...virtual].map((e, k) => ({ e, k })).sort((a, b) => a.e.word - b.e.word || a.k - b.k).map((x) => x.e)
}

/**
 * @param {FuzzyIndex} index
 * @param {ReturnType<typeof createMorphSearch>} search
 * @param {ReturnType<typeof createMorphSearch> | null} open 虛擬詞根用的構詞搜尋（null：不求虛擬詞根）
 * @param {number} from
 * @param {number} to
 */
function analyzeRange(index, search, open, from, to) {
  const terms = index.terms
  /** @type {DerivationEdge[]} 自動派生圖的邊 */
  const edges = []
  /** @type {DerivationEdge[]} 拆解表 */
  const parses = []
  /** @type {Array<[number, number]>} 拆解表：BCDP 最好的命中不是拆法（詞根不比詞短或含空白）的詞，與那個命中的成本 */
  const bests = []
  /** @type {DerivationEdge[]} 虛擬詞根的候選 */
  const virtual = []
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
 * （例句體例展開的讀法，pattern/search.js 的 _unlistedParses）都用這個函式，所以兩邊的結果一定相同。
 * @param {string} w
 * @param {FuzzyIndex} index
 * @param {ReturnType<typeof createMorphSearch>} search
 * @param {boolean} [withNotes] 自動派生圖的邊附上音變說明（句型搜尋不需要）
 * @param {ReturnType<typeof createMorphSearch> | null} [open] 虛擬詞根用的構詞搜尋（createVirtualRootSearch；省略時不求虛擬詞根）
 * @returns {{edges: Array<{root: number, analysis: DerivationAnalysis}>, parses: Array<{root: number, analysis: DerivationAnalysis}>, best: number | null,
 *   virtual: ReturnType<typeof virtualRoots>}}
 *   edges 是自動派生圖的邊（BCDP 成本最低的詞庫詞根，同分全收，詞根比詞短）；parses 是拆解表（每個候選詞根，
 *   詞根比詞短、是單一個詞）；best 是 BCDP 最好的命中不是拆法時（詞根不比詞短或含空白）那個命中的成本，否則 null；
 *   virtual 是虛擬詞根（virtualRoots，詞庫中最好的詞根取 edges 的成本；還沒過濾「詞本身不是根」）
 */
export function analyzeWord(w, index, search, withNotes = true, open = null) {
  const length = Array.from(w).length
  /** @type {Array<{root: number, analysis: DerivationAnalysis}>} */
  const edges = []
  /** @type {Array<{root: number, analysis: DerivationAnalysis}>} */
  const parses = []
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
    const notes = withNotes ? search.notesOf(/** @type {NonNullable<typeof prepared>} */ (prepared), hit) : []
    edges.push({ root, analysis: { cost: roundCost(hit.distance), steps: hit.steps, notes } })
  }
  const virtual = open ? virtualRoots(w, open, index, lexicalEdgeCost(w, hits)) : []
  return { edges, parses, best, virtual }
}

/**
 * 詞 w 在詞庫中最好的詞根的成本，也就是自動派生圖上 w 的詞庫詞根邊的成本：BCDP 最好的命中（含詞根不比詞短的）
 * 若有詞根比詞短的與它同分，就是那個成本；否則 w 沒有詞庫詞根的邊，是 Infinity（例如最好的命中是同樣長的 'a'ata，
 * 而不是 ma'ata 的詞根）。虛擬詞根要比它便宜才成立（virtualRoots 的 lexiconBest）。
 * 建置（analyzeWord）與查詢（engine 的自動同根）共用這個定義，詞庫中的詞在兩端拆出的虛擬詞根才會相同
 * （研究紀錄 U.24：查詢端原本取所有命中的最低成本，同樣長的相近詞把虛擬詞根擋掉）。
 * @param {string} w
 * @param {Array<{term: string, distance: number}>} hits BCDP 的全部命中（finish 的結果）
 */
export function lexicalEdgeCost(w, hits) {
  const length = Array.from(w).length
  let best = Infinity
  let edge = Infinity
  for (const h of hits) {
    best = Math.min(best, h.distance)
    if (Array.from(h.term).length < length) edge = Math.min(edge, h.distance)
  }
  return edge <= best + EPSILON ? roundCost(edge) : Infinity
}

/**
 * 一個詞的虛擬詞根（條件見檔頭）：同一個 BCDP 的字面開放詞幹（open.openStems），詞綴必須原樣出現（open 只有構詞音變），
 * 詞根比詞短、不在詞庫中、形狀像詞根；分數（成本 ＋ virtualRootCost）比詞庫中最好的詞根（lexiconBest）便宜的，
 * 取分數最低的（同分全收）。成本是步驟成本加上構詞音變（BCDP 的成本），不含 virtualRootCost。
 * @param {string} w
 * @param {ReturnType<typeof createMorphSearch>} open 虛擬詞根用的構詞搜尋（createVirtualRootSearch）
 * @param {FuzzyIndex} index 詞庫
 * @param {number} lexiconBest BCDP 在詞庫中最好的詞根的成本（沒有時 Infinity）
 * @returns {Array<{stem: string, cost: number, steps: import('../fuzzy/morph-search.js').MorphStepHit[], notes: DerivationAnalysis['notes']}>}
 *   notes 是構詞音變的說明（成本 ＝ 步驟成本 ＋ notes 的成本）
 */
export function virtualRoots(w, open, index, lexiconBest) {
  if (w.includes(' ')) return []
  const spec = open.spec
  const length = Array.from(w).length
  // 詞根至少 minStem ＋ 1 個字元（形狀），所以成本超過這個上限的分析分數不可能比詞庫的好
  const bound = Math.min(DERIVATION_MAX_COST, lexiconBest - spec.virtualRootLengthCost * (spec.minStem + 1))
  if (bound < 0) return []
  const prepared = open.prepare(w, DERIVATION_MAX_COST)
  if (!prepared) return []
  const keep = (/** @type {string} */ v) => Array.from(v).length < length && index.dawg.lookup(v) === -1 && isVirtualRootShape(v, spec)
  const results = open.openStems(prepared, { keep, bound })
  /** @type {Map<string, number>} 詞幹 → 分數 */
  const score = new Map()
  for (const list of results) for (const r of list) score.set(r.term, Math.min(score.get(r.term) ?? Infinity, r.distance + virtualRootCost(r.term, spec)))
  const ok = [...score].filter(([, x]) => x < lexiconBest - EPSILON)
  if (ok.length === 0) return []
  const min = Math.min(...ok.map(([, x]) => x))
  const chosen = new Set(ok.filter(([, x]) => x <= min + EPSILON).map(([v]) => v))
  // 說明：每個選到的詞根取成本最低的分析，同分依 finish 的規則選一種拆法
  return open
    .finish(
      prepared,
      results.map((list) => list.filter((r) => chosen.has(r.term))),
      DERIVATION_MAX_COST,
    )
    .filter((h) => chosen.has(h.term))
    .map((h) => ({ stem: h.term, cost: h.distance, steps: h.steps, notes: open.notesOf(prepared, h) }))
}

/**
 * 把 analyze 的結果（依詞編號排序）寫成 derivations.json 的內容（分析去重；虛擬詞根依字典序編號）。
 * @param {DerivationEdge[]} edges
 * @param {number} count 詞圖的詞數
 * @returns {DerivationData}
 */
export function encodeDerivations(edges, count) {
  return encodeEdges(edges, count, DERIVATIONS_FORMAT_VERSION)
}

/**
 * 邊（依詞編號排序）的編碼，derivations.json 與 parses.json 共用（格式見檔頭）。
 * @param {DerivationEdge[]} edges
 * @param {number} count 詞圖的詞數
 * @param {number} version
 * @returns {DerivationData}
 */
export function encodeEdges(edges, count, version) {
  const virtual = [...new Set(edges.flatMap((e) => (typeof e.root === 'string' ? [e.root] : [])))].sort()
  const virtualIds = new Map(virtual.map((v, k) => [v, count + k]))
  /** 去重：同樣內容的物件只存一次，回傳它的編號 @template T @param {T[]} table @param {Map<string, number>} ids @param {T} value */
  const intern = (table, ids, value) => {
    const key = JSON.stringify(value)
    let k = ids.get(key)
    if (k === undefined) {
      k = table.length
      ids.set(key, k)
      table.push(value)
    }
    return k
  }
  /** @type {DerivationData['steps']} */
  const steps = []
  /** @type {DerivationData['analyses']} */
  const analyses = []
  const stepIds = new Map()
  const analysisIds = new Map()
  /** @type {number[]} */
  const flat = []
  let prev = 0
  for (const { word, root, analysis } of edges) {
    /** @type {DerivationData['analyses'][number]} */
    const encoded = [
      analysis.cost,
      analysis.steps.map((st) => intern(steps, stepIds, st)),
      analysis.notes.map((n) => [n.op, n.source, n.target, n.cost, n.category, n.where]),
    ]
    flat.push(word - prev, typeof root === 'string' ? /** @type {number} */ (virtualIds.get(root)) : root, intern(analyses, analysisIds, encoded))
    prev = word
  }
  return { version, count, virtual, steps, analyses, edges: flat }
}

/**
 * 建立自動派生圖（單執行緒；測試與評估工具用，網站建置另有平行版本）。
 * @param {{lexicon: import('../fuzzy/fuzzy-index.js').SerializedIndex, profile: import('../fuzzy/profile.js').LanguageProfile}} input
 * @returns {DerivationData}
 */
export function buildDerivationGraph({ lexicon, profile }) {
  const analyzer = createDerivationAnalyzer({ lexicon, profile })
  const lexical = analyzer.analyze()
  return encodeDerivations(mergeEdges(lexical, analyzer.virtual(lexical)), analyzer.count)
}

/**
 * @typedef {object} DerivedReach 由某個起點走到的自動派生形
 * @property {number} word 詞編號（一定是詞庫中的詞）
 * @property {number} cost 總分：起點距離＋路徑上各條邊的成本
 * @property {number} seed 起點在 seeds 中的位置
 * @property {Array<{word: number, root: number, analysis: DerivationAnalysis}>} path 由起點往下的每一條邊（最後一條進入 word）
 */

/**
 * 查詢端：自動派生圖（詞根 → 衍生詞）。節點編號：詞庫中的詞是 0…count−1，虛擬詞根接在後面。
 * 虛擬詞根只有往下的邊（它不是任何詞的衍生詞），只能當起點。
 */
export class DerivationGraph {
  /**
   * @param {DerivationData} data
   * @param {string[]} terms 詞圖的所有詞（詞編號＝索引）
   * @param {(root: string) => number} [rootCost] 詞庫詞根依音節數的成本（構詞搜尋的 rootCost）：邊的成本含它，算音變時扣掉
   */
  constructor(data, terms, rootCost = () => 0) {
    if (data.version !== DERIVATIONS_FORMAT_VERSION) {
      throw new Error(`自動派生圖格式版本 ${data.version} 與框架（${DERIVATIONS_FORMAT_VERSION}）不符，請重新建置網站`)
    }
    if (data.count !== terms.length) throw new Error(`自動派生圖的詞數（${data.count}）與詞圖（${terms.length}）不符，請重新建置網站`)
    /** @type {DerivationAnalysis[]} */
    this.analyses = data.analyses.map(([cost, steps, notes]) => ({
      cost,
      steps: steps.map((k) => data.steps[k]),
      notes: notes.map(([op, source, target, c, category, where]) => ({ op, source, target, cost: c, category, where })),
    }))
    this.terms = terms
    /** 節點（詞根）依音節數的成本：詞庫中的詞才有，虛擬詞根是 0 @param {number} id */
    this.rootCostOf = (id) => (id < terms.length ? rootCost(terms[id]) : 0)
    /** 所有節點的寫法：詞庫中的詞，接著是虛擬詞根 */
    this.nodes = [...terms, ...(data.virtual ?? [])]
    /** @type {Map<string, number>} 虛擬詞根 → 節點編號 */
    this.virtualIds = new Map((data.virtual ?? []).map((v, k) => [v, terms.length + k]))
    /** @type {Map<number, Array<{word: number, analysis: number}>>} 詞根 → 由它衍生的詞 */
    this.children = new Map()
    const e = data.edges
    for (let k = 0, word = 0; k + 2 < e.length; k += 3) {
      word += e[k]
      let list = this.children.get(e[k + 1])
      if (!list) this.children.set(e[k + 1], (list = []))
      list.push({ word, analysis: e[k + 2] })
    }
    /** @type {Map<number, number>} */
    this._length = new Map()
  }

  /** @param {number} id */
  _len(id) {
    let n = this._length.get(id)
    if (n === undefined) this._length.set(id, (n = Array.from(this.nodes[id]).length))
    return n
  }

  /** 節點是不是虛擬詞根 @param {number} id */
  isVirtual(id) {
    return id >= this.terms.length
  }

  /** 有沒有詞以這個節點為詞根 @param {number} id */
  hasChildren(id) {
    return (this.children.get(id)?.length ?? 0) > 0
  }

  /**
   * 起點的直接子詞（以起點為最好詞根的詞），只取音變不超過 maxSound 的邊；起點距離加上邊的成本不超過 maxPath。
   * 同一個詞由幾個起點走到時取總分最小的。詞庫詞根的自動同根用：同根就是同一個詞根的直接子詞，不含孫輩。
   * @param {Array<{id: number, distance: number, rootCost?: number}>} seeds distance 含查詢拆到這個詞根的詞根成本時，rootCost 記下它（上限不算）
   * @param {{maxPath: number, maxSound: number}} options
   * @returns {DerivedReach[]} 依總分排序（同分依詞編號），不含起點本身
   */
  childrenOf(seeds, { maxPath, maxSound }) {
    /** @type {Map<number, DerivedReach>} */
    const best = new Map()
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
   * @param {Array<{id: number, distance: number}>} seeds 起點（詞編號）與它和查詢的距離
   * @param {number} [maxPath]
   * @returns {DerivedReach[]} 依總分排序（同分依詞編號），不含起點本身
   */
  descendants(seeds, maxPath = DERIVATION_MAX_COST) {
    // 1. 找出走得到的詞（路徑成本各自不超過上限，先寬鬆收集）
    /** @type {Set<number>} */
    const reach = new Set()
    const stack = seeds.map((s) => s.id)
    while (stack.length) {
      const x = /** @type {number} */ (stack.pop())
      for (const c of this.children.get(x) ?? []) {
        // 上限比不含詞根成本的成本（詞根成本只改名次，docs/bcdp.md 1.6 第 9 項）
        if (this.analyses[c.analysis].cost - this.rootCostOf(x) > maxPath + EPSILON || reach.has(c.word)) continue
        reach.add(c.word)
        stack.push(c.word)
      }
    }
    // 2. 依詞長（拓撲順序）鬆弛
    /** @type {Map<number, {cost: number, path: number, seed: number, from: number, analysis: number}>} */
    const best = new Map()
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
    /** @type {DerivedReach[]} */
    const out = []
    for (const [word, b] of best) {
      if (seedIds.has(word)) continue
      /** @type {DerivedReach['path']} */
      const path = []
      for (let x = word, at = b; at.from !== -1; x = at.from, at = /** @type {typeof b} */ (best.get(at.from))) {
        path.unshift({ word: x, root: at.from, analysis: this.analyses[at.analysis] })
      }
      out.push({ word, cost: b.cost, seed: b.seed, path })
    }
    return out.sort((a, b) => a.cost - b.cost || a.word - b.word)
  }
}
