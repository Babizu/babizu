/**
 * @file 以 DAWG（詞圖）＋ 動態規劃剪枝，找出詞庫中所有「距離在門檻內」的詞。
 *
 * ## 做法
 * 深度優先走訪詞圖。走到深度 j 的節點，就代表候選字串 Y 的前 j 個字元已確定，
 * 這時算出 DP 的第 j 列。共用前綴的詞共用上層的列，不必重算。
 *
 * 底層結構是 DAWG（見 dawg.js）：它同時合併共同前綴與共同後綴，節點數比 Trie 少很多。
 * 對搜尋演算法而言介面幾乎一樣（取子節點、是否為詞尾、子樹高度），差別有兩點：
 * - 節點會被多個詞共用，所以附帶資料不能掛在節點上。改用完美雜湊：DFS 沿著邊累加
 *   `wordsBefore`，抵達詞尾時就得到這個詞的字典序名次，再用名次索引 payload 陣列。
 * - 同一個節點可能出現在走訪的不同位置（共用後綴）。這不影響正確性：
 *   DP 的列取決於「走到這裡的路徑」，而 DFS 中每條路徑只會走一次。
 *
 * ## 詞尾規則
 * 每個節點最多算兩列（見 dp.js 檔頭）：N_j 假設下一字元不是邊界，F_j 假設是詞尾。
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
 */

import { Dawg } from './dawg.js'
import { fillRow, prepareColumn, roundCost, EPSILON } from './dp.js'
import { resolveNormalization } from './normalization.js'

/**
 * @typedef {object} QueryExpansion 查詢展開（詞形還原的預留介面）
 * @property {string} form 展開後的查詢形式，例如去掉前綴後的詞根
 * @property {number} cost 額外加上的成本
 * @property {string} [note] 說明，例如「去前綴 mu-」
 */

/** @typedef {(query: string) => QueryExpansion[]} QueryExpander */

/**
 * @typedef {object} SearchOptions
 * @property {number} [maxDistance=1] 絕對距離上限（含）
 * @property {number} [maxNormalized=Infinity] 正規化分數上限（含）
 * @property {string | Partial<import('./normalization.js').NormalizationStrategy>} [normalization='none'] 用於 score 與 maxNormalized
 * @property {number} [limit=Infinity] 最多回傳幾筆
 * @property {QueryExpander[]} [expanders] 查詢展開器（實驗性，見 expanders.js）
 * @property {(event: NodeVisit) => void} [onNode] 每走訪一個節點回呼一次（視覺化用）
 */

/**
 * @typedef {object} NodeVisit
 * @property {string} prefix 此節點代表的前綴
 * @property {number} depth
 * @property {number} node 詞圖中的節點編號（共用後綴時會在不同位置重複出現）
 * @property {number} lowerBound 子樹內任何詞的距離下界
 * @property {number} bound 此子樹允許的絕對距離上界
 * @property {boolean} pruned 是否在此剪枝
 * @property {boolean} terminal 此節點是否為詞尾
 * @property {number | null} distance 若為詞尾，該詞的距離
 * @property {boolean} accepted 若為詞尾，是否符合門檻
 */

/**
 * @typedef {object} SearchResult
 * @property {string} term 詞庫中的詞（已正規化）
 * @property {number} distance 絕對距離
 * @property {number} score 正規化分數（normalization='none' 時等於 distance）
 * @property {unknown[]} payloads 加入詞庫時附帶的資料
 * @property {string} [via] 若經由查詢展開找到，記錄展開說明
 */

/**
 * @typedef {object} SearchStats
 * @property {number} visitedNodes
 * @property {number} prunedNodes
 * @property {number} computedRows
 */

/**
 * @typedef {object} SerializedIndex
 * @property {string} format
 * @property {number} version
 * @property {import('./dawg.js').SerializedDawg} dawg
 * @property {unknown[][]} payloads 依詞的字典序排列
 */

export const INDEX_FORMAT = 'pazeh-fuzzy-index'
export const INDEX_VERSION = 2

export class FuzzyIndex {
  /**
   * @param {import('./distance.js').WeightedEditDistance} metric
   * @param {{dawg: Dawg, payloads: unknown[][]}} [built] 已建好的詞圖（反序列化時使用）
   */
  constructor(metric, built) {
    this.metric = metric
    /** @type {Map<string, unknown[]> | null} 建構中的詞與附帶資料；凍結後釋放 */
    this._entries = built ? null : new Map()
    /** @type {Dawg | null} */
    this._dawg = built?.dawg ?? null
    /** @type {unknown[][]} 依詞的字典序排列 */
    this._payloads = built?.payloads ?? []
    /** @type {string[] | null} 詞表快取（需要逐詞比對時才展開） */
    this._terms = null
  }

  /** 詞數 */
  get size() {
    return this._entries ? this._entries.size : this.dawg.size
  }

  /** 詞圖（第一次使用時才建立） */
  get dawg() {
    if (!this._dawg) this.freeze()
    return /** @type {Dawg} */ (this._dawg)
  }

  /** 所有詞（字典序）。第一次呼叫時才展開成陣列。 */
  get terms() {
    if (!this._terms) this._terms = this.dawg.words()
    return this._terms
  }

  /** 每個詞的附帶資料，順序與 `terms` 相同 */
  get payloads() {
    this.dawg // 確保已建立
    return this._payloads
  }

  /**
   * 加入一個詞。詞會先經過 metric 的正規化；正規化後為空字串的詞會被忽略。
   * @param {string} term
   * @param {unknown} [payload] 附帶資料（例如資料庫中的記錄編號）
   * @returns {this}
   */
  add(term, payload) {
    const key = this.metric.normalize(term)
    if (key === '') return this
    const entries = this._unfreeze()
    let list = entries.get(key)
    if (!list) entries.set(key, (list = []))
    if (payload !== undefined) list.push(payload)
    return this
  }

  /**
   * 批次加入。
   * @param {Iterable<[string, unknown] | string>} items
   */
  addAll(items) {
    for (const item of items) {
      if (Array.isArray(item)) this.add(item[0], item[1])
      else this.add(item)
    }
    return this
  }

  /**
   * 建立詞圖。加入新詞後會在下一次使用時自動重建，一般不需要自己呼叫。
   */
  freeze() {
    const entries = this._entries ?? new Map()
    const dawg = Dawg.build([...entries.keys()])
    /** @type {unknown[][]} */
    const payloads = new Array(dawg.size)
    for (const [term, list] of entries) payloads[dawg.lookup(term)] = list
    for (let k = 0; k < payloads.length; k++) payloads[k] ??= []
    this._dawg = dawg
    this._payloads = payloads
    this._entries = null
    this._terms = null
    return this
  }

  /**
   * 回到可新增詞的狀態（必要時由詞圖還原）。
   * @returns {Map<string, unknown[]>}
   * @private
   */
  _unfreeze() {
    if (this._entries) return this._entries
    /** @type {Map<string, unknown[]>} */
    const entries = new Map()
    if (this._dawg) this.terms.forEach((term, k) => entries.set(term, this._payloads[k] ?? []))
    this._entries = entries
    this._dawg = null
    this._terms = null
    return entries
  }

  /**
   * 精確查詢（經正規化）。
   * @param {string} term
   * @returns {unknown[] | undefined}
   */
  lookup(term) {
    const index = this.dawg.lookup(this.metric.normalize(term))
    return index === -1 ? undefined : this._payloads[index]
  }

  /**
   * 依詞的字典序名次取得詞與附帶資料。
   * @param {number} id
   */
  entry(id) {
    return { term: this.dawg.wordAt(id), payloads: this._payloads[id] }
  }

  /**
   * 模糊搜尋。
   * @param {string} query
   * @param {SearchOptions} [options]
   * @returns {SearchResult[]} 依 score、distance、詞排序
   *
   * @example
   * index.search('bintul', { maxDistance: 0.5 })
   * // → [{ term: 'bintun', distance: 0.1, score: 0.1, payloads: [...] }, ...]
   */
  search(query, options = {}) {
    return this.searchWithStats(query, options).results
  }

  /**
   * 模糊搜尋，並回傳走訪統計。
   * @param {string} query
   * @param {SearchOptions} [options]
   * @returns {{results: SearchResult[], stats: SearchStats}}
   */
  searchWithStats(query, options = {}) {
    const { limit = Infinity, expanders = [] } = options
    const stats = { visitedNodes: 0, prunedNodes: 0, computedRows: 0 }
    const norm = resolveNormalization(options.normalization ?? 'none')
    const queryLength = this.metric.prepare(query).length

    /** @type {Map<string, SearchResult>} */
    const merged = new Map()
    for (const r of this._searchCore(query, options, stats)) merged.set(r.term, r)

    // 查詢展開：以較低的距離預算搜尋展開形式，加上展開成本後合併（取較小者）
    for (const expand of expanders) {
      for (const { form, cost, note } of expand(query)) {
        const budget = (options.maxDistance ?? 1) - cost
        if (budget < 0) continue
        const sub = this._searchCore(form, { ...options, maxDistance: budget, maxNormalized: Infinity }, stats)
        for (const r of sub) {
          const distance = roundCost(r.distance + cost)
          const score = roundCost(norm.score(distance, queryLength, Array.from(r.term).length))
          if (score > (options.maxNormalized ?? Infinity) + EPSILON) continue
          const prev = merged.get(r.term)
          if (!prev || score < prev.score) {
            merged.set(r.term, { ...r, distance, score, via: note ?? form })
          }
        }
      }
    }

    const results = [...merged.values()].sort(
      (a, b) => a.score - b.score || a.distance - b.distance || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0),
    )
    return { results: Number.isFinite(limit) ? results.slice(0, limit) : results, stats }
  }

  /**
   * 搜尋主體：詞圖深度優先走訪 + 逐列 DP + 剪枝。
   * @param {string} query
   * @param {SearchOptions} options
   * @param {SearchStats} stats 累加統計
   * @returns {SearchResult[]}
   * @private
   */
  _searchCore(query, options, stats) {
    const { maxDistance = 1, maxNormalized = Infinity, onNode } = options
    const norm = resolveNormalization(options.normalization ?? 'none')
    const { compiled, costs } = this.metric
    const x = this.metric.prepare(query)
    const n = x.length
    const plan = compiled.compileQuery(x)
    const span = compiled.maxTargetLength
    const dawg = this.dawg
    const payloads = this._payloads

    /** @type {string[]} 目前走訪路徑上的字元 */
    const path = []
    /**
     * rowsN[j]、rowsF[j]：路徑上第 j 層的兩種列；minN[j]、minF[j] 為各列最小值。
     * 同一深度的兄弟節點依序走訪，前一個兄弟的子樹走完才會覆寫，所以每層各配置一次即可重複使用。
     * @type {Float64Array[]}
     */
    const rowsN = []
    /** @type {Float64Array[]} */
    const rowsF = []
    /** @type {number[]} */
    const minN = []
    /** @type {number[]} */
    const minF = []
    /** 第 r 列（r < 目前深度）是否該用 F 列：看路徑上第 r 個字元是否為邊界 */
    const useF = (/** @type {number} */ r) => compiled.isBoundary(path[r])
    const rowAt = (/** @type {number} */ r) => (useF(r) ? rowsF[r] : rowsN[r])

    /** @type {SearchResult[]} */
    const results = []

    /**
     * @param {number} node 詞圖節點編號
     * @param {number} j 深度
     * @param {number} base 這個節點的子樹中，第一個詞的字典序名次
     */
    const visit = (node, j, base) => {
      stats.visitedNodes++
      const isTerminal = dawg.isFinal(node)
      const firstEdge = dawg.firstEdge(node)
      const endEdge = dawg.endEdge(node)

      let hasBoundaryChild = false
      let hasOtherChild = false
      for (let e = firstEdge; e < endEdge; e++) {
        if (compiled.isBoundary(dawg.label(e))) hasBoundaryChild = true
        else hasOtherChild = true
      }

      const column = prepareColumn(plan, compiled, path, j, rowAt)

      // N_j：子節點不是邊界字元時使用
      const rowN = (rowsN[j] ??= new Float64Array(n + 1))
      fillRow(plan, compiled, costs, column, false, rowN)
      minN[j] = minOf(rowN)
      stats.computedRows++

      // F_j：只有「本節點是詞尾」或「有邊界字元的子節點」時才會被用到
      let rowF = rowN
      if (plan.hasFinal && (isTerminal || hasBoundaryChild)) {
        rowF = rowsF[j] && rowsF[j] !== rowN ? rowsF[j] : new Float64Array(n + 1)
        fillRow(plan, compiled, costs, column, true, rowF)
        stats.computedRows++
      }
      rowsF[j] = rowF
      minF[j] = rowF === rowN ? minN[j] : minOf(rowF)

      // 此子樹允許的絕對距離上界
      let bound = maxDistance
      if (Number.isFinite(maxNormalized) && norm.bound) {
        bound = Math.min(bound, norm.bound(maxNormalized, n, j + dawg.height[node]))
      }

      // 詞尾：記錄結果。base 就是這個詞的字典序名次（完美雜湊）
      let distance = null
      let accepted = false
      if (isTerminal) {
        distance = roundCost(rowF[n])
        if (distance <= maxDistance + EPSILON) {
          const score = roundCost(norm.score(distance, n, j))
          if (score <= maxNormalized + EPSILON) {
            accepted = true
            results.push({ term: path.slice(0, j).join(''), distance, score, payloads: payloads[base] ?? [] })
          }
        }
      }

      // 剪枝：子樹內任何詞距離的下界（證明見檔頭）
      let lowerBound = Infinity
      if (hasOtherChild) lowerBound = minN[j]
      if (hasBoundaryChild) lowerBound = Math.min(lowerBound, minF[j])
      for (let r = Math.max(0, j - span + 1); r < j; r++) {
        const jump = compiled.jumpWeights.get(/** @type {string} */ (column.suffix[j - r]))
        if (jump !== undefined) lowerBound = Math.min(lowerBound, (useF(r) ? minF[r] : minN[r]) + jump)
      }
      const pruned = endEdge > firstEdge && lowerBound > bound + EPSILON

      if (onNode) {
        onNode({
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

      if (pruned) {
        stats.prunedNodes++
        return
      }
      for (let e = firstEdge; e < endEdge; e++) {
        path[j] = dawg.label(e)
        visit(dawg.target(e), j + 1, base + dawg.wordsBefore(e))
      }
      path.length = j
    }

    visit(dawg.root, 0, 0)
    return results
  }

  /**
   * 序列化為可 JSON 化的物件（不含 metric；還原時需提供相同設定的 metric）。
   * @returns {SerializedIndex}
   */
  serialize() {
    return {
      format: INDEX_FORMAT,
      version: INDEX_VERSION,
      dawg: this.dawg.toJSON(),
      payloads: this._payloads,
    }
  }

  /**
   * 由序列化資料還原索引。
   * @param {SerializedIndex} data
   * @param {import('./distance.js').WeightedEditDistance} metric
   */
  static deserialize(data, metric) {
    if (data?.format !== INDEX_FORMAT) {
      throw new TypeError(`不是可辨識的序列化索引（format 應為 ${INDEX_FORMAT}）`)
    }
    if (data.version !== INDEX_VERSION) throw new RangeError(`不支援的序列化版本 ${data.version}`)
    return new FuzzyIndex(metric, { dawg: Dawg.fromJSON(data.dawg), payloads: data.payloads })
  }
}

/** @param {Float64Array} row */
function minOf(row) {
  let m = Infinity
  for (let i = 0; i < row.length; i++) if (row[i] < m) m = row[i]
  return m
}
