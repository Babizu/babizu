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
 * 詞根不在詞庫中時，BCDP 兩個方向都找不到：查 binubuer（b<in>ubuer）找不到 mabubuer（ma-bubuer），
 * 因為兩者共同的詞根 bubuer 不是任何記錄的詞形。所以建置時另外以構詞分析器（精確的列舉，不含方言音變）
 * 拆出詞庫外的詞幹，符合三個條件時記一條邊 w → 虛擬詞根 v：
 * 1. **詞庫裡沒有同樣好的詞根**：v 的成本加上 `VIRTUAL_ROOT_PENALTY` 仍比 BCDP 在詞庫中最好的詞根便宜
 *    （沒有詞庫詞根時一律成立）。所以原本的邊一條都不動，只在詞庫解釋不了的地方補上；
 * 2. **形狀像一個詞根**（`isVirtualRootShape`）：至少兩個元音、比 minStem 長，太短的詞幹容易巧合相同；
 * 3. **本身是「根」**：v 不能再拆出詞庫中的詞（mabaketan 拆出的 baketan、mabaket 只是 baket 加上一個詞綴，不算）；
 * 4. 只取這個詞成本最低的虛擬詞根（同分的都取）。
 * 查詢時再拆一次查詢本身，拆出的詞幹若是虛擬詞根，就由它往下走：找到的是與查詢推定同一個詞根的詞
 * （命中方式 sibling，介面標「自動同根」）。虛擬詞根本身不是結果，也不參與其他命中方式。
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

import { createMorphSearch, EPSILON, FuzzyIndex, roundCost } from '../fuzzy/index.js'
import { createTextTools } from './text.js'

/** derivations.json 的格式版本（2：加上虛擬詞根） */
export const DERIVATIONS_FORMAT_VERSION = 2

/** 一條邊的分析成本上限（與自動拆解方向的上限 LEMMA_MAX_DISTANCE 相同） */
export const DERIVATION_MAX_COST = 1

/**
 * 經過虛擬詞根的代價：詞庫中沒有這個詞根，推定的把握較小。建置時虛擬詞根要比詞庫中的詞根好這麼多才建立；
 * 查詢時經過虛擬詞根的命中加上一次（查詢 → 虛擬詞根 → 詞，只算一次）
 */
export const VIRTUAL_ROOT_PENALTY = 0.1

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
 * 建立「求最好的詞根」的分析器：`analyze(from, to)` 對詞庫中編號在 [from, to) 的詞求邊。
 * 建置端可以切塊平行執行（src/site/derivations.js），各塊的結果依詞編號接起來，與一次算完相同。
 * @param {{lexicon: import('../fuzzy/fuzzy-index.js').SerializedIndex, profile: import('../fuzzy/profile.js').LanguageProfile}} input
 */
export function createDerivationAnalyzer({ lexicon, profile }) {
  const text = createTextTools(profile)
  const metric = text.createSearchMetric()
  const index = FuzzyIndex.deserialize(lexicon, metric)
  const search = text.morphology ? createMorphSearch({ analyzer: text.morphology, metric, index }) : null
  return {
    /** 詞圖的詞數 */
    count: index.size,
    /**
     * @param {number} [from]
     * @param {number} [to]
     * @returns {DerivationEdge[]} 依詞編號排序
     */
    analyze: (from = 0, to = Infinity) =>
      search && text.morphology ? analyzeRange(index, search, text.morphology, from, to) : [],
  }
}

/**
 * @param {FuzzyIndex} index
 * @param {ReturnType<typeof createMorphSearch>} search
 * @param {import('../fuzzy/morphology.js').Analyzer} analyzer
 * @param {number} from
 * @param {number} to
 */
function analyzeRange(index, search, analyzer, from, to) {
  const terms = index.terms
  /** @type {DerivationEdge[]} */
  const out = []
  for (let word = from; word < Math.min(to, terms.length); word++) {
    const w = terms[word]
    const length = Array.from(w).length
    // 1. 詞庫中的詞根：BCDP 成本最低的（同分全收），詞根比詞短
    let best = Infinity
    const prepared = search.prepare(w, DERIVATION_MAX_COST)
    const hits = prepared ? search.finish(prepared, index.searchChannels(search.seed(prepared).channels), DERIVATION_MAX_COST) : []
    for (const hit of hits) {
      if (hit.distance > hits[0].distance + EPSILON) break
      if (Array.from(hit.term).length >= length) continue
      const notes = search.notesOf(/** @type {NonNullable<typeof prepared>} */ (prepared), hit)
      out.push({ word, root: index.dawg.lookup(hit.term), analysis: { cost: roundCost(hit.distance), steps: hit.steps, notes } })
      best = Math.min(best, hit.distance)
    }
    // 2. 虛擬詞根：詞庫解釋不了（或解釋得差很多）時，構詞分析器拆出的詞庫外詞幹（見檔頭）
    for (const v of virtualRoots(w, analyzer, index, best)) out.push({ word, root: v.stem, analysis: { cost: roundCost(v.cost), steps: v.steps, notes: [] } })
  }
  return out
}

/**
 * 一個詞的虛擬詞根：構詞分析器拆出的、不在詞庫中、形狀像詞根、本身再拆不出詞庫中的詞的詞幹，
 * 成本加上 VIRTUAL_ROOT_PENALTY 仍比詞庫中最好的詞根（lexiconBest）便宜的，取成本最低的幾個（同分全收）。
 * 分析器是精確的列舉（構詞音變算在步驟裡，沒有方言音變），成本就是步驟成本的和。
 * @param {string} w
 * @param {import('../fuzzy/morphology.js').Analyzer} analyzer
 * @param {FuzzyIndex} index
 * @param {number} lexiconBest
 */
export function virtualRoots(w, analyzer, index, lexiconBest) {
  if (w.includes(' ')) return []
  const length = Array.from(w).length
  const candidates = analyzer
    .analyze(w)
    .filter(
      (a) =>
        a.steps.length > 0 &&
        Array.from(a.stem).length < length &&
        a.cost + VIRTUAL_ROOT_PENALTY < lexiconBest - EPSILON &&
        isVirtualRootShape(a.stem, analyzer.spec) &&
        index.dawg.lookup(a.stem) === -1 &&
        !analyzer.analyze(a.stem).some((b) => index.dawg.lookup(b.stem) !== -1),
    )
  if (candidates.length === 0) return []
  const min = Math.min(...candidates.map((a) => a.cost))
  /** @type {Map<string, {stem: string, cost: number, steps: any[]}>} 同一個詞幹只留一種拆法（第一個，與分析器的順序相同） */
  const out = new Map()
  for (const a of candidates) if (a.cost <= min + EPSILON && !out.has(a.stem)) out.set(a.stem, { stem: a.stem, cost: a.cost, steps: [...a.steps] })
  return [...out.values()]
}

/**
 * 把 analyze 的結果（依詞編號排序）寫成 derivations.json 的內容（分析去重；虛擬詞根依字典序編號）。
 * @param {DerivationEdge[]} edges
 * @param {number} count 詞圖的詞數
 * @returns {DerivationData}
 */
export function encodeDerivations(edges, count) {
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
  return { version: DERIVATIONS_FORMAT_VERSION, count, virtual, steps, analyses, edges: flat }
}

/**
 * 建立自動派生圖（單執行緒；測試與評估工具用，網站建置另有平行版本）。
 * @param {{lexicon: import('../fuzzy/fuzzy-index.js').SerializedIndex, profile: import('../fuzzy/profile.js').LanguageProfile}} input
 * @returns {DerivationData}
 */
export function buildDerivationGraph({ lexicon, profile }) {
  const analyzer = createDerivationAnalyzer({ lexicon, profile })
  return encodeDerivations(analyzer.analyze(), analyzer.count)
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
   */
  constructor(data, terms) {
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
        if (this.analyses[c.analysis].cost > maxPath + EPSILON || reach.has(c.word)) continue
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
        const path = at.path + edge
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
