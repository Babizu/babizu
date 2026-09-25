/**
 * @file 兩字串之間的廣義加權編輯距離。
 */

import { CostModel } from './costs.js'
import { CompiledRules, fillRow, PathMatcher, prepareColumn, roundCost, EPSILON } from './dp.js'
import { createNormalizer } from './normalize.js'
import { resolveNormalization } from './normalization.js'
import { RuleSet } from './rules.js'

/**
 * @typedef {object} MetricOptions
 * @property {CostModel | import('./costs.js').CostOptions} [costs] 基本成本（預設替換 1.5／刪除 1.0／插入 0.8／空白 0.1）
 * @property {RuleSet | import('./rules.js').RuleTableRow[] | import('./rules.js').RuleGroup[]} [rules] 語音對應規則
 * @property {((text: string) => string) | import('./normalize.js').NormalizerOptions} [normalize] 正規化函式或其選項
 * @property {string[]} [boundaries=[' ']] 詞邊界字元，決定 initial／final 規則的「詞」範圍
 */

/**
 * @typedef {object} AlignmentStep 對齊路徑中的一步
 * @property {import('./dp.js').Operation} op
 * @property {string} source X 側片段（刪除／規則脫落時可能是空字串）
 * @property {string} target Y 側片段
 * @property {number} cost 這一步的成本
 * @property {[number, number]} from 起點 (i, j)
 * @property {[number, number]} to 終點 (i, j)
 * @property {{source: string, target: string, weight: number, position: string, category: string|null, label: string|null, reversed: boolean} | null} rule
 */

/**
 * @typedef {object} CellCandidate 某一格的候選轉移
 * @property {import('./dp.js').Operation} op
 * @property {number} cost 經由此轉移到達該格的總成本
 * @property {number} stepCost
 * @property {[number, number]} from
 * @property {AlignmentStep['rule']} rule
 */

/**
 * @typedef {object} Explanation explain() 的輸出：完整的 DP 表與回溯路徑
 * @property {string[]} query 正規化後的查詢字元
 * @property {string[]} candidate 正規化後的候選字元
 * @property {number} distance
 * @property {Record<string, number>} normalized 各正規化策略的分數
 * @property {number[][]} matrix matrix[i][j] = D(i, j)
 * @property {CellCandidate[][][]} candidates candidates[i][j]：該格所有候選轉移，依成本排序，第一個即勝出者
 * @property {Array<[number, number]>} path 回溯路徑上的格子，由 (0,0) 到 (N,M)
 * @property {AlignmentStep[]} alignment
 * @property {Array<[number, number]>} order 計算順序（外層 j、內層 i），可用於逐格動畫
 * @property {boolean[]} finalColumns finalColumns[j]：第 j 欄是否位於候選字串的詞尾（允許 final 規則）
 */

/** explain 在成本相同時的偏好順序：相同字元 > 規則 > 替換 > 刪除 > 插入 */
const OP_PRIORITY = { match: 0, rule: 1, substitute: 2, delete: 3, insert: 4 }

export class WeightedEditDistance {
  /** @param {MetricOptions} [options] */
  constructor(options = {}) {
    const { costs, rules, normalize, boundaries = [' '] } = options

    /** @type {(text: string) => string} */
    this.normalize = typeof normalize === 'function' ? normalize : createNormalizer(normalize)
    /** @type {Set<string>} */
    this.boundaries = new Set(boundaries.map((b) => this.normalize(b) || b))
    this.setCosts(costs)
    this.setRules(rules)
  }

  /**
   * 替換基本成本。
   * @param {CostModel | import('./costs.js').CostOptions} [costs]
   */
  setCosts(costs) {
    /** @type {CostModel} */
    this.costs = costs instanceof CostModel ? costs : new CostModel(costs)
    return this
  }

  /**
   * 替換規則集合（例如在介面上開關某一類規則後）。
   * 注意：正規化函式不可替換，否則已建立的索引會失效。
   * @param {MetricOptions['rules']} [rules]
   */
  setRules(rules) {
    /** @type {RuleSet} */
    this.ruleSet =
      rules instanceof RuleSet ? rules : RuleSet.fromTable(/** @type {any} */ (rules ?? []))
    this.compiled = new CompiledRules(this.ruleSet.expand(this.normalize), this.boundaries)
    /** @type {PathMatcher | null} `_rows` 重複使用的路徑匹配器（屬於目前這組規則） */
    this._matcher = null
    /** `_rows` 的巢狀深度：追蹤回呼中又呼叫距離函式時，內層另外配置匹配器 */
    this._rowsDepth = 0
    return this
  }

  /**
   * 正規化並拆成 code point。
   * @param {string} text
   */
  prepare(text) {
    return Array.from(this.normalize(text))
  }

  /**
   * 計算把 query 轉為 candidate 的最小加權成本。
   * @param {string} query
   * @param {string} candidate
   * @returns {number}
   *
   * @example
   * metric.distance('bintul', 'bintun') // → 0.1（詞尾 l → n）
   */
  distance(query, candidate) {
    const x = this.prepare(query)
    const y = this.prepare(candidate)
    const rows = this._matrix(x, y, null)
    return roundCost(rows[y.length][x.length])
  }

  /**
   * 預先編譯查詢：同一個查詢要和很多候選字串比較時（例如構詞搜尋的計價），
   * 只算一次成本表與規則表，之後以 `distancePrepared` 逐一計算。
   * 與 `distance` 不同，這裡不做正規化：x 與 y 必須已經是 `prepare()` 的結果。
   * @param {string[]} x 已正規化的查詢字元
   * @returns {import('./dp.js').QueryPlan}
   */
  prepareQuery(x) {
    return this.compiled.compileQuery(x, this.costs)
  }

  /**
   * 以預先編譯的查詢計算距離。`distancePrepared(prepareQuery(prepare(q)), prepare(c))`
   * 與 `distance(q, c)` 逐位元相同。
   * @param {import('./dp.js').QueryPlan} plan `prepareQuery` 的結果（須在同一組規則與成本下編譯）
   * @param {string[]} y 已正規化的候選字元
   * @returns {number}
   */
  distancePrepared(plan, y) {
    const rows = this._rows(plan, y, null)
    return roundCost(rows[y.length][plan.n])
  }

  /**
   * 正規化後的距離。
   * @param {string} query
   * @param {string} candidate
   * @param {string | Partial<import('./normalization.js').NormalizationStrategy>} [strategy='max']
   */
  normalizedDistance(query, candidate, strategy = 'max') {
    const norm = resolveNormalization(strategy)
    const x = this.prepare(query)
    const y = this.prepare(candidate)
    const d = this._matrix(x, y, null)[y.length][x.length]
    return roundCost(norm.score(d, x.length, y.length))
  }

  /**
   * 詳細解釋：回傳整張 DP 表、每格的所有候選轉移、最佳回溯路徑與對齊結果。
   * 計算量比 distance 大，適合視覺化或顯示「為什麼這兩個詞相近」。
   * @param {string} query
   * @param {string} candidate
   * @returns {Explanation}
   */
  explain(query, candidate) {
    const x = this.prepare(query)
    const y = this.prepare(candidate)
    const n = x.length
    const m = y.length

    /** @type {CellCandidate[][][]} */
    const candidates = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => []))
    const rows = this._matrix(x, y, (t) => {
      candidates[t.i][t.j].push({
        op: t.op,
        cost: roundCost(t.cost),
        stepCost: roundCost(t.stepCost),
        from: [t.fromI, t.fromJ],
        rule: t.rule ? publicRule(t.rule) : null,
      })
    })

    for (const row of candidates) {
      for (const cell of row) {
        cell.sort((a, b) => a.cost - b.cost || OP_PRIORITY[a.op] - OP_PRIORITY[b.op])
      }
    }

    const matrix = Array.from({ length: n + 1 }, (_, i) =>
      Array.from({ length: m + 1 }, (_, j) => roundCost(rows[j][i])),
    )

    // 由右下角沿著每格的最佳候選回溯
    /** @type {AlignmentStep[]} */
    const alignment = []
    /** @type {Array<[number, number]>} */
    const path = [[n, m]]
    let i = n
    let j = m
    while (i > 0 || j > 0) {
      const best = candidates[i][j].find((c) => Math.abs(c.cost - matrix[i][j]) <= EPSILON)
      if (!best) break // 理論上不會發生：非起點的格子一定有來源
      const [fi, fj] = best.from
      alignment.push({
        op: best.op,
        source: x.slice(fi, i).join(''),
        target: y.slice(fj, j).join(''),
        cost: best.stepCost,
        from: [fi, fj],
        to: [i, j],
        rule: best.rule,
      })
      i = fi
      j = fj
      path.push([i, j])
    }
    alignment.reverse()
    path.reverse()

    /** @type {Array<[number, number]>} */
    const order = []
    for (let jj = 0; jj <= m; jj++) for (let ii = 0; ii <= n; ii++) order.push([ii, jj])

    const distance = matrix[n][m]
    return {
      query: x,
      candidate: y,
      distance,
      normalized: {
        max: roundCost(resolveNormalization('max').score(distance, n, m)),
        sum: roundCost(resolveNormalization('sum').score(distance, n, m)),
        query: roundCost(resolveNormalization('query').score(distance, n, m)),
      },
      matrix,
      candidates,
      path,
      alignment,
      order,
      finalColumns: Array.from({ length: m + 1 }, (_, jj) => this._isWordEnd(y, jj)),
    }
  }

  /**
   * 只求最佳對齊，結果與 `explain(query, candidate).alignment` 逐位元相同，但不建整張候選表。
   *
   * explain 把每格的候選依（四捨五入後的成本, OP_PRIORITY）穩定排序，回溯時取第一個成本等於該格數值的。
   * 排在第一個的就是成本最小者，而該格的數值正是最小成本，所以回溯取的一定是排序後的第一個。
   * 因此每格只需記住「成本最小；同成本時 OP_PRIORITY 較小；再相同時先回報者」的那一個候選。
   * 搜尋時對每個模糊命中都要說明音變（只用到對齊），這樣省下大部分配置。
   * @param {string} query
   * @param {string} candidate
   * @returns {AlignmentStep[]}
   */
  align(query, candidate) {
    const x = this.prepare(query)
    const y = this.prepare(candidate)
    const n = x.length
    const m = y.length
    const size = (n + 1) * (m + 1)
    const cost = new Float64Array(size)
    const priority = new Int8Array(size)
    const fromI = new Int32Array(size).fill(-1)
    const fromJ = new Int32Array(size)
    const stepCost = new Float64Array(size)
    /** @type {Array<import('./dp.js').Operation>} */
    const ops = new Array(size)
    /** @type {Array<import('./dp.js').CompiledRule | null>} */
    const rules = new Array(size)
    const rows = this._matrix(x, y, (t) => {
      const at = t.i * (m + 1) + t.j
      const c = roundCost(t.cost)
      const p = OP_PRIORITY[t.op]
      if (fromI[at] !== -1 && !(c < cost[at] || (c === cost[at] && p < priority[at]))) return
      cost[at] = c
      priority[at] = p
      fromI[at] = t.fromI
      fromJ[at] = t.fromJ
      stepCost[at] = roundCost(t.stepCost)
      ops[at] = t.op
      rules[at] = t.rule
    })

    // 由右下角沿著每格選定的候選回溯（與 explain 相同）
    /** @type {AlignmentStep[]} */
    const alignment = []
    let i = n
    let j = m
    while (i > 0 || j > 0) {
      const at = i * (m + 1) + j
      if (fromI[at] === -1 || Math.abs(cost[at] - roundCost(rows[j][i])) > EPSILON) break
      const fi = fromI[at]
      const fj = fromJ[at]
      const rule = rules[at]
      alignment.push({
        op: ops[at],
        source: x.slice(fi, i).join(''),
        target: y.slice(fj, j).join(''),
        cost: stepCost[at],
        from: [fi, fj],
        to: [i, j],
        rule: rule ? publicRule(rule) : null,
      })
      i = fi
      j = fj
    }
    return alignment.reverse()
  }

  /**
   * 候選字串固定時，逐列計算整張表。
   * 回傳 rows[j][i]（外層為 j，與詞圖逐層往下的方向一致）。
   * @param {string[]} x
   * @param {string[]} y
   * @param {((t: import('./dp.js').Transition) => void) | null} trace
   * @returns {Float64Array[]}
   * @private
   */
  _matrix(x, y, trace) {
    return this._rows(this.compiled.compileQuery(x, this.costs), y, trace)
  }

  /**
   * 以已編譯的查詢逐列計算整張表。候選字串 Y 的字元逐一送進路徑匹配器
   * （與詞圖搜尋相同的程式路徑，只是路徑只有一條）。
   * @param {import('./dp.js').QueryPlan} plan
   * @param {string[]} y
   * @param {((t: import('./dp.js').Transition) => void) | null} trace
   * @returns {Float64Array[]}
   * @private
   */
  _rows(plan, y, trace) {
    const compiled = this.compiled
    const reuse = this._rowsDepth === 0 && this._matcher?.compiled === compiled
    const matcher = reuse ? /** @type {PathMatcher} */ (this._matcher) : new PathMatcher(compiled)
    if (this._rowsDepth === 0) this._matcher = matcher
    this._rowsDepth++
    try {
      /** @type {Float64Array[]} */
      const rows = []
      const rowAt = (/** @type {number} */ r) => rows[r]
      for (let j = 0; j <= y.length; j++) {
        if (j > 0) matcher.set(j, compiled.idOf(y[j - 1]))
        const row = new Float64Array(plan.n + 1)
        const column = prepareColumn(plan, compiled, matcher, j, rowAt)
        fillRow(plan, compiled, column, this._isWordEnd(y, j), row, trace)
        rows.push(row)
      }
      return rows
    } finally {
      this._rowsDepth--
    }
  }

  /**
   * 前 j 個字元之後是否為詞尾（字串結束或下一字元是邊界）。
   * @param {string[]} y
   * @param {number} j
   * @private
   */
  _isWordEnd(y, j) {
    return j === y.length || this.compiled.isBoundary(y[j])
  }
}

/**
 * 只保留規則的公開欄位，避免把內部索引資訊暴露給呼叫端。
 * @param {import('./dp.js').CompiledRule} rule
 */
function publicRule(rule) {
  const { source, target, weight, position, category, label, reversed } = rule
  return { source, target, weight, position, category, label, reversed }
}
