/**
 * @file 衍生關係圖：查詞根時找到它的加綴變化（衍生形方向，docs/bcdp.md 第 10 節）。
 *
 * 建置時以構詞搜尋 BCDP 對詞庫中每個詞 w（含例句中的詞）求**成本最低的詞根** r（同分的都取），
 * 詞根必須比 w 短（以字元計），記一條邊 w → r，附上 BCDP 對 w 的分析。查詢時由查詢（與它的相近寫法）
 * 沿反向的邊往下走：查 sungut 得到 pusungut（pu-），再由 pusungut 得到 pausunguday（<a>、-ay）。
 *
 * - 兩個方向一致：「查 r 看到 w」等於「查 w 時 r 是最好的詞根」，每條邊都是 BCDP 算出來的，
 *   不需要另一套演算法。
 * - 沒有循環：邊一定由較短的詞根指向較長的詞，所以依長度由短到長鬆弛一遍就是最短路徑，走訪一定停止。
 * - 只取最好的詞根、允許遞移：比收下所有詞根雜訊少得多，召回幾乎一樣（研究紀錄的評估）。
 *
 * ## derivations.json
 * ```
 * { version, count, steps: [MorphStepHit…], analyses: [[cost, [步驟編號…], [音變…]]…], edges: [Δw, r, a, Δw, r, a, …] }
 * ```
 * - `count`：詞圖的詞數（詞編號＝詞圖的字典序名次，與 lexicon.json 同一份）
 * - `steps`：去重的構詞步驟（含語法說明）；詞綴只有幾十種，每個步驟只存一次
 * - `analyses`：去重的分析：成本（步驟成本＋音變）、步驟編號（由外而內）、音變說明
 *   （每一個寫成 [op, source, target, cost, category, where]）
 * - `edges`：三個一組，詞 w（與上一條邊的差；邊依 w 排序）、詞根 r、分析編號 a
 */

import { createMorphSearch, EPSILON, FuzzyIndex, roundCost } from '../fuzzy/index.js'
import { createTextTools } from './text.js'

/** derivations.json 的格式版本 */
export const DERIVATIONS_FORMAT_VERSION = 1

/** 一條邊的分析成本上限（與詞根相符方向的上限 LEMMA_MAX_DISTANCE 相同） */
export const DERIVATION_MAX_COST = 1

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
 * @property {import('../fuzzy/morph-search.js').MorphStepHit[]} steps
 * @property {Array<[number, number[], Array<[string, string, string, number, string | null, string]>]>} analyses
 * @property {number[]} edges
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
     * @returns {Array<{word: number, root: number, analysis: DerivationAnalysis}>} 依詞編號排序
     */
    analyze: (from = 0, to = Infinity) => (search ? analyzeRange(index, search, from, to) : []),
  }
}

/**
 * @param {FuzzyIndex} index
 * @param {ReturnType<typeof createMorphSearch>} search
 * @param {number} from
 * @param {number} to
 */
function analyzeRange(index, search, from, to) {
  const terms = index.terms
  /** @type {Array<{word: number, root: number, analysis: DerivationAnalysis}>} */
  const out = []
  for (let word = from; word < Math.min(to, terms.length); word++) {
    const w = terms[word]
    const prepared = search.prepare(w, DERIVATION_MAX_COST)
    if (!prepared) continue
    const hits = search.finish(prepared, index.searchChannels(search.seed(prepared).channels), DERIVATION_MAX_COST)
    if (hits.length === 0) continue
    const length = Array.from(w).length
    for (const hit of hits) {
      if (hit.distance > hits[0].distance + EPSILON) break
      if (Array.from(hit.term).length >= length) continue
      const notes = search.notesOf(prepared, hit)
      out.push({ word, root: index.dawg.lookup(hit.term), analysis: { cost: roundCost(hit.distance), steps: hit.steps, notes } })
    }
  }
  return out
}

/**
 * 把 analyze 的結果（依詞編號排序）寫成 derivations.json 的內容（分析去重）。
 * @param {Array<{word: number, root: number, analysis: DerivationAnalysis}>} edges
 * @param {number} count 詞圖的詞數
 * @returns {DerivationData}
 */
export function encodeDerivations(edges, count) {
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
    flat.push(word - prev, root, intern(analyses, analysisIds, encoded))
    prev = word
  }
  return { version: DERIVATIONS_FORMAT_VERSION, count, steps, analyses, edges: flat }
}

/**
 * 建立衍生關係圖（單執行緒；測試與評估工具用，網站建置另有平行版本）。
 * @param {{lexicon: import('../fuzzy/fuzzy-index.js').SerializedIndex, profile: import('../fuzzy/profile.js').LanguageProfile}} input
 * @returns {DerivationData}
 */
export function buildDerivationGraph({ lexicon, profile }) {
  const analyzer = createDerivationAnalyzer({ lexicon, profile })
  return encodeDerivations(analyzer.analyze(), analyzer.count)
}

/**
 * @typedef {object} DerivedReach 由某個起點走到的衍生形
 * @property {number} word 詞編號
 * @property {number} cost 總分：起點距離＋路徑上各條邊的成本
 * @property {number} seed 起點在 seeds 中的位置
 * @property {Array<{word: number, root: number, analysis: DerivationAnalysis}>} path 由起點往下的每一條邊（最後一條進入 word）
 */

/** 查詢端：衍生關係圖（詞根 → 衍生詞） */
export class DerivationGraph {
  /**
   * @param {DerivationData} data
   * @param {string[]} terms 詞圖的所有詞（詞編號＝索引）
   */
  constructor(data, terms) {
    if (data.version !== DERIVATIONS_FORMAT_VERSION) {
      throw new Error(`衍生關係圖格式版本 ${data.version} 與框架（${DERIVATIONS_FORMAT_VERSION}）不符，請重新建置網站`)
    }
    if (data.count !== terms.length) throw new Error(`衍生關係圖的詞數（${data.count}）與詞圖（${terms.length}）不符，請重新建置網站`)
    /** @type {DerivationAnalysis[]} */
    this.analyses = data.analyses.map(([cost, steps, notes]) => ({
      cost,
      steps: steps.map((k) => data.steps[k]),
      notes: notes.map(([op, source, target, c, category, where]) => ({ op, source, target, cost: c, category, where })),
    }))
    this.terms = terms
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
    if (n === undefined) this._length.set(id, (n = Array.from(this.terms[id]).length))
    return n
  }

  /**
   * 由起點往下找所有衍生形，每個詞取總分最小的路徑；路徑本身的成本（不含起點距離）不超過 maxPath。
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
