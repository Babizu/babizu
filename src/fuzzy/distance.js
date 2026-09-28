/**
 * @file 兩字串之間的廣義加權編輯距離。
 */

import { CostModel } from './costs.js'
import { advanceCrossing, CompiledRules, createCrossing, EDGE_JUNCTION, EDGE_NONE, EDGE_WORD, fillRow, jumpBound, PathMatcher, prepareColumn, roundCost, EPSILON } from './dp.js'
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
   * 鏡像距離函式：每條（有方向的）規則的 source、target 反轉，initial ↔ final 對調，成本與詞邊界相同。
   * 對任何 x、y：mirror().distance(reverse(x), reverse(y)) ＝ distance(x, y)，因為對齊反過來讀就是
   * 鏡像的對齊。構詞搜尋用它由詞尾往前算後綴鏈（docs/bcdp.md 第 5 節）。
   * 輸入必須已經正規化（鏡像的 normalize 是恆等函式）。規則替換（setRules）後重新建立。
   * @returns {WeightedEditDistance}
   */
  mirror() {
    if (this._mirror?.from === this.compiled) return this._mirror.metric
    const swap = /** @type {const} */ ({ initial: 'final', final: 'initial', any: 'any' })
    const reverse = (/** @type {string} */ s) => Array.from(s).reverse().join('')
    const rules = new RuleSet()
    for (const r of this.ruleSet.expand(this.normalize)) {
      rules.add(reverse(r.source), reverse(r.target), r.weight, {
        position: swap[r.position],
        bidirectional: false, // 展開後已經包含兩個方向
        category: r.category ?? undefined,
        label: r.label ?? undefined,
        junction: r.junction,
      })
    }
    const metric = new WeightedEditDistance({ costs: this.costs, rules, normalize: (s) => s, boundaries: [...this.boundaries] })
    /** @type {{from: CompiledRules, metric: WeightedEditDistance} | undefined} */
    this._mirror = { from: this.compiled, metric }
    return metric
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
    return this.explainChars(this.prepare(query), this.prepare(candidate))
  }

  /**
   * 與 explain 相同，但輸入是已正規化的 code point 陣列（不再正規化），並可以帶邊界條件：
   * start 取代第 0 列的起點成本（交界列；docs/bcdp.md 第 4 節）。
   * @param {string[]} x
   * @param {string[]} y
   * @param {import('./dp.js').QueryOptions} [options]
   * @returns {Explanation}
   */
  explainChars(x, y, options = {}) {
    const n = x.length
    const m = y.length

    /** @type {CellCandidate[][][]} */
    const candidates = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => []))
    const rows = this._rows(this.compiled.compileQuery(x, this.costs, options), y, (t) => {
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
   * 整個詞（幾個詞素接起來）的聯合對齊說明，與構詞搜尋同一套交界語意（docs/bcdp.md 1.3）：
   * 一段一段計算，段與段之間以交界狀態銜接（交界列＋跨界的規則），所以跨越交界的規則、交界上的
   * 構詞音變都會出現在對齊中。回傳整張表（所有段的欄接在一起）、回溯路徑與對齊；
   * 對齊的每一步另外標出它在底層字串上的範圍，呼叫端可以據此分到各詞素。
   *
   * @param {string[]} x 查詢（已正規化）
   * @param {Array<{chars: string[], lock?: boolean}>} segments 各詞素；lock：詞綴（不能消耗查詢的空白）
   * @param {object} [options]
   * @param {number} [options.startEdge=EDGE_WORD] 第一段的開頭是詞首還是交界（重疊的詞幹開頭是交界）
   * @param {{segment: number, x: number}} [options.pinStart] 第 segment 段必須由查詢位置 x 開始（中綴、重疊）
   * @param {{segment: number, allowed: Set<number>}} [options.pinEnd] 第 segment 段必須在 allowed 的某個位置結束
   * @returns {Explanation & {junctions: number[], segmentOf: number[]}}
   */
  explainSegments(x, segments, options = {}) {
    const compiled = this.compiled
    const n = x.length
    const offsets = []
    let total = 0
    for (const s of segments) {
      offsets.push(total)
      total += s.chars.length
    }
    const y = segments.flatMap((s) => s.chars)
    const grid = () => Array.from({ length: n + 1 }, () => Array.from({ length: total + 1 }, () => /** @type {CellCandidate[]} */ ([])))
    /**
     * 交界欄有兩層：前一段的交界列（prev）與後一段的第 0 列（main：由交界列出發、再做只動查詢的轉移）。
     * 沒有固定交界時兩層的值相同；固定交界時 main 只由固定的位置出發，比固定位置小的格子只存在於 prev。
     * 回溯時由 main 走到「由交界列進入」的格子，就換到 prev 繼續。
     */
    const mainCand = grid()
    const prevCand = grid()
    /** @type {Float64Array[]} */
    const mainCol = new Array(total + 1)
    /** @type {Array<Float64Array | undefined>} */
    const prevCol = new Array(total + 1)
    /** @type {Array<((i: number) => boolean) | undefined>} 交界欄：哪些位置可以由前一段進入後一段 */
    const entry = new Array(total + 1)
    /** @type {{row: Float64Array, pending: Array<{node: number, row: Float64Array}>} | null} */
    let state = null
    const pin = (/** @type {Float64Array} */ row, /** @type {(x: number) => boolean} */ keep) => {
      for (let i = 0; i <= n; i++) if (!keep(i)) row[i] = Infinity
    }
    segments.forEach((seg, k) => {
      const m = seg.chars.length
      const last = k === segments.length - 1
      const start = state ? Float64Array.from(state.row) : null
      const pinnedStart = options.pinStart?.segment === k
      /** @type {(i: number) => boolean} */
      let enter = () => true
      if (pinnedStart) {
        const at = /** @type {{x: number}} */ (options.pinStart).x
        enter = (i) => i === at
      }
      if (options.pinEnd?.segment === k - 1) enter = (i) => /** @type {Set<number>} */ (options.pinEnd?.allowed).has(i)
      if (start) pin(start, enter)
      entry[offsets[k]] = enter
      const plan = compiled.compileQuery(x, this.costs, { start, junctions: true, lockBoundary: Boolean(seg.lock) })
      const matcher = new PathMatcher(compiled)
      const startEdge = k === 0 ? (options.startEdge ?? EDGE_WORD) : EDGE_JUNCTION
      /** @type {import('./dp.js').Crossing[]} */
      const cross = []
      if (state && state.pending.length && !pinnedStart) {
        const c0 = createCrossing(state.pending.length)
        state.pending.forEach((p, q) => {
          c0.nodes[q] = p.node
          c0.rows[q] = p.row
          c0.mins[q] = Math.min(...p.row)
        })
        c0.count = state.pending.length
        cross[0] = c0
      }
      /** @type {Float64Array[]} */
      const rows = []
      const rowAt = (/** @type {number} */ r) => rows[r]
      for (let j = 0; j <= m; j++) {
        if (j > 0) matcher.set(j, compiled.idOf(seg.chars[j - 1]))
        let crossing = null
        if (j > 0 && cross[j - 1]?.count) crossing = advanceCrossing(compiled, cross[j - 1], matcher.ids[j - 1], (cross[j] = createCrossing(cross[0].nodes.length)))
        const column = prepareColumn(plan, compiled, matcher, j, rowAt, startEdge, crossing)
        // 段內：依下一個字元是不是邊界；段尾：交界列，或最後一段的詞尾
        const fin = j < m ? (compiled.isBoundary(seg.chars[j]) ? EDGE_WORD : EDGE_NONE) : last ? EDGE_WORD : EDGE_JUNCTION
        const row = new Float64Array(n + 1)
        const g = offsets[k] + j
        // 段尾的交界列放在 prev 層（後一段的第 0 列才是這一欄的 main 層）
        const toPrev = j === m && !last
        const target = toPrev ? prevCand : mainCand
        fillRow(plan, compiled, column, fin, row, (t) => {
          target[t.i][g].push({
            op: t.op,
            cost: roundCost(t.cost),
            stepCost: roundCost(t.stepCost),
            from: [t.fromI, offsets[k] + t.fromJ],
            rule: t.rule ? publicRule(t.rule) : null,
          })
        })
        rows.push(row)
        if (toPrev) prevCol[g] = row
        else mainCol[g] = row
      }
      // 最後一段固定詞尾：只接受在允許的位置結束
      if (last && options.pinEnd?.segment === k) pin(rows[m], (i) => /** @type {Set<number>} */ (options.pinEnd?.allowed).has(i))
      /** @type {Array<{node: number, row: Float64Array}>} */
      const pending = []
      const base = m * matcher.cap
      for (let q = 0; q < matcher.counts[m]; q++) {
        const s = matcher.states[base + q]
        if (compiled.trieJump[s] === Infinity) continue
        pending.push({ node: s, row: rows[m - compiled.trieDepth[s]] })
      }
      const pinnedEnd = options.pinEnd?.segment === k
      state = { row: rows[m], pending: pinnedEnd ? [] : pending }
    })

    const byCost = (/** @type {CellCandidate} */ a, /** @type {CellCandidate} */ b) => a.cost - b.cost || OP_PRIORITY[a.op] - OP_PRIORITY[b.op]
    for (const layer of [mainCand, prevCand]) for (const row of layer) for (const cell of row) cell.sort(byCost)
    const matrix = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: total + 1 }, (_, j) => roundCost(mainCol[j][i])))
    /** @type {AlignmentStep[]} */
    const alignment = []
    /** @type {Array<[number, number]>} */
    const path = [[n, total]]
    let i = n
    let j = total
    let layer = 'main'
    // 回溯：沿著每格成本等於格值的第一個候選；在交界欄由 main 層「由交界列進入」的格子換到 prev 層
    while (i > 0 || j > 0) {
      const prev = prevCol[j]
      const value = roundCost(layer === 'main' ? mainCol[j][i] : /** @type {Float64Array} */ (prev)[i])
      const cands = layer === 'main' ? mainCand[i][j] : prevCand[i][j]
      const best = cands.find((c) => Math.abs(c.cost - value) <= EPSILON)
      if (!best) {
        const enter = entry[j]
        if (layer === 'main' && prev && enter?.(i) && Math.abs(roundCost(prev[i]) - value) <= EPSILON) {
          layer = 'prev'
          continue
        }
        break
      }
      const [fi, fj] = best.from
      alignment.push({ op: best.op, source: x.slice(fi, i).join(''), target: y.slice(fj, j).join(''), cost: best.stepCost, from: [fi, fj], to: [i, j], rule: best.rule })
      if (fj !== j) layer = 'main'
      i = fi
      j = fj
      path.push([i, j])
    }
    // 顯示用：交界欄的候選是兩層合在一起
    const candidates = mainCand.map((row, i) => row.map((cell, j) => [...prevCand[i][j], ...cell].sort(byCost)))
    alignment.reverse()
    path.reverse()
    /** @type {Array<[number, number]>} */
    const order = []
    for (let jj = 0; jj <= total; jj++) for (let ii = 0; ii <= n; ii++) order.push([ii, jj])
    const distance = matrix[n][total]
    const segmentOf = []
    segments.forEach((s, k) => s.chars.forEach(() => segmentOf.push(k)))
    return {
      query: x,
      candidate: y,
      distance,
      normalized: {
        max: roundCost(resolveNormalization('max').score(distance, n, total)),
        sum: roundCost(resolveNormalization('sum').score(distance, n, total)),
        query: roundCost(resolveNormalization('query').score(distance, n, total)),
      },
      matrix,
      candidates,
      path,
      alignment,
      order,
      finalColumns: Array.from({ length: total + 1 }, (_, jj) => jj === total || compiled.isBoundary(y[jj])),
      junctions: offsets.slice(1),
      segmentOf,
    }
  }

  /**
   * 單一段（一個詞素）的追蹤 DP：由交界狀態 from 出發，在 exit 指定的地方結束，回溯出這一段的對齊，
   * 並回報對齊是由 from 的哪一格（或哪一個跨界狀態）進來的。構詞搜尋用它找出命中是哪一條詞綴鏈：
   * 合併後的交界狀態每一格記著它來自哪個詞綴，一段一段往回追就得到整條鏈（docs/bcdp.md 第 8 節）。
   *
   * @param {string[]} x 查詢
   * @param {string[]} y 這一段的字元
   * @param {object} o
   * @param {{row: Float64Array, pending: Array<{node: number, row: Float64Array}>} | null} o.from 起點；null 表示詞首
   * @param {number} [o.startEdge] 起點的位置種類（預設有 from 時是交界，否則是詞首）
   * @param {boolean} [o.lock=false] 詞綴：不能消耗查詢的空白
   * @param {Exit} o.exit 在哪裡結束（見 Exit）
   * @returns {{cost: number, entry: Entry, exit: Exit & {cost?: number}, steps: AlignmentStep[]}}
   *
   * @typedef {{kind: 'start'} | {kind: 'row', x: number} | {kind: 'pending', node: number, x: number}} Entry
   *   由詞首、交界列的第 x 格，或跨界狀態 node 起點那一列的第 x 格進入這一段
   * @typedef {{kind: 'word'} | {kind: 'row', x: number} | {kind: 'pending', node: number, x: number}
   *   | {kind: 'couple', to: import('./fuzzy-index.js').JunctionEnd}} Exit
   *   詞尾（終點 (n, |y|)）；交界列的第 x 格；本段尾端跨界狀態 node（深度 d）起點那一列（第 |y| − d 列）的第 x 格；
   *   或與後一段 to 耦合、取最小者（回報實際的出口）
   */
  traceSegment(x, y, o) {
    const compiled = this.compiled
    const n = x.length
    const m = y.length
    const from = o.from
    const plan = compiled.compileQuery(x, this.costs, { start: from?.row ?? null, junctions: true, lockBoundary: Boolean(o.lock) })
    const matcher = new PathMatcher(compiled)
    const startEdge = o.startEdge ?? (from ? EDGE_JUNCTION : EDGE_WORD)
    /** @type {import('./dp.js').Crossing[]} */
    const cross = []
    if (from && from.pending.length) {
      const c0 = createCrossing(from.pending.length)
      from.pending.forEach((p, q) => {
        c0.nodes[q] = p.node
        c0.rows[q] = p.row
        c0.mins[q] = Math.min(...p.row)
      })
      c0.count = from.pending.length
      cross[0] = c0
    }
    /** @type {Float64Array[]} */
    const rows = []
    /** @type {CellCandidate[][][]} cand[j][i]（第 m 列另有 F 列與交界列兩份：candF、candJ） */
    const cand = []
    const rowAt = (/** @type {number} */ r) => rows[r]
    /** @param {CellCandidate[][]} into */
    const tracer = (into) => (/** @type {import('./dp.js').Transition} */ t) => {
      into[t.i].push({ op: t.op, cost: roundCost(t.cost), stepCost: roundCost(t.stepCost), from: [t.fromI, t.fromJ], rule: t.rule ? publicRule(t.rule) : null })
    }
    let rowF = /** @type {Float64Array} */ (new Float64Array(0))
    let rowJ = rowF
    /** @type {CellCandidate[][]} */
    let candF = []
    /** @type {CellCandidate[][]} */
    let candJ = []
    for (let j = 0; j <= m; j++) {
      if (j > 0) matcher.set(j, compiled.idOf(y[j - 1]))
      let crossing = null
      if (j > 0 && cross[j - 1]?.count) crossing = advanceCrossing(compiled, cross[j - 1], matcher.ids[j - 1], (cross[j] = createCrossing(cross[0].nodes.length)))
      const column = prepareColumn(plan, compiled, matcher, j, rowAt, startEdge, crossing)
      const blank = () => Array.from({ length: n + 1 }, () => /** @type {CellCandidate[]} */ ([]))
      if (j < m) {
        const row = new Float64Array(n + 1)
        const c = blank()
        fillRow(plan, compiled, column, compiled.isBoundary(y[j]) ? EDGE_WORD : EDGE_NONE, row, tracer(c))
        rows.push(row)
        cand.push(c)
      } else {
        // 最後一列：詞尾（F 列）與交界列兩份；段內的轉移（跨界出口）引用的是 F 列（下一個字元不存在）
        rowF = new Float64Array(n + 1)
        candF = blank()
        fillRow(plan, compiled, column, EDGE_WORD, rowF, tracer(candF))
        rowJ = new Float64Array(n + 1)
        candJ = blank()
        fillRow(plan, compiled, column, EDGE_JUNCTION, rowJ, tracer(candJ))
        rows.push(rowF)
        cand.push(candF)
      }
    }
    for (const c of [...cand, candJ]) for (const cell of c) cell.sort((a, b) => a.cost - b.cost || OP_PRIORITY[a.op] - OP_PRIORITY[b.op])

    // 出口：回溯的起點（列、格、用哪一份候選），以及跨界出口本身那一步
    /** @type {{j: number, i: number, cands: CellCandidate[][], rowVal: Float64Array}} */
    let at = { j: m, i: n, cands: candF, rowVal: rowF }
    /** @type {AlignmentStep | null} */
    let last = null
    /** @type {Exit & {cost?: number}} */
    let exit = o.exit
    let cost = Infinity
    const trailing = (/** @type {number} */ node) => {
      const d = compiled.trieDepth[node]
      return { j: m - d, rowVal: rows[m - d], cands: cand[m - d] }
    }
    if (o.exit.kind === 'word') {
      cost = rowF[n]
    } else if (o.exit.kind === 'row') {
      at = { j: m, i: o.exit.x, cands: candJ, rowVal: rowJ }
      cost = rowJ[o.exit.x]
    } else if (o.exit.kind === 'pending') {
      at = { ...trailing(o.exit.node), i: o.exit.x }
      cost = at.rowVal[o.exit.x]
    } else {
      const to = o.exit.to
      if (to.word) {
        for (let i = 0; i <= n; i++) {
          if (rowF[i] + to.word[i] < cost) {
            cost = rowF[i] + to.word[i]
            at = { j: m, i, cands: candF, rowVal: rowF }
            exit = { kind: 'word' }
          }
        }
      }
      if (to.row) {
        for (let i = 0; i <= n; i++) {
          if (rowJ[i] + to.row[i] < cost) {
            cost = rowJ[i] + to.row[i]
            at = { j: m, i, cands: candJ, rowVal: rowJ }
            exit = { kind: 'row', x: i }
          }
        }
      }
      // 跨界出口：規則 target ＝ 本段尾巴（trie 狀態 s）· 後一段開頭（tail）
      const base = m * matcher.cap
      for (let k = 0; k < matcher.counts[m]; k++) {
        const s = matcher.states[base + k]
        if (compiled.trieJump[s] === Infinity) continue
        const d = compiled.trieDepth[s]
        to.pending.forEach((p, b) => {
          const node = compiled.trieWalk(s, p.tail)
          const T = node === -1 ? -1 : compiled.trieTarget[node]
          if (T === -1) return
          for (let q = plan.ruleOff[T]; q < plan.ruleOff[T + 1]; q++) {
            if (plan.ruleFlag[q] !== 0) continue
            const i = plan.ruleI[q]
            const src = plan.ruleSrc[q]
            const v = rows[m - d][i - src] + plan.ruleW[q] + p.row[i]
            if (v < cost) {
              cost = v
              at = { j: m - d, i: i - src, cands: cand[m - d], rowVal: rows[m - d] }
              exit = { kind: 'pending', node: s, x: i, tail: b }
              const rule = publicRule(plan.ruleRef[q])
              last = { op: 'rule', source: x.slice(i - src, i).join(''), target: rule.target, cost: roundCost(plan.ruleW[q]), from: [i - src, m - d], to: [i, m + p.tail.length], rule }
            }
          }
        })
      }
    }

    /** @type {AlignmentStep[]} */
    const steps = last ? [last] : []
    /** @type {Entry} */
    let entry = { kind: 'start' }
    let { i, j } = at
    let cands = at.cands
    let rowVal = at.rowVal
    for (;;) {
      const value = roundCost(rowVal[i])
      const best = cands[i].find((c) => Math.abs(c.cost - value) <= EPSILON)
      if (!best) {
        // 沒有轉移能到這一格：它是起點（第 0 列的交界列值，或詞首的 (0, 0)）
        entry = j === 0 && from ? { kind: 'row', x: i } : { kind: 'start' }
        break
      }
      const [fi, fj] = best.from
      steps.push({ op: best.op, source: x.slice(fi, i).join(''), target: y.slice(Math.max(0, fj), j).join(''), cost: best.stepCost, from: [fi, fj], to: [i, j], rule: best.rule })
      if (fj < 0) {
        // 由前一段的跨界狀態進來：target 的前 −fj 個字元在前一段
        const target = Array.from(/** @type {NonNullable<typeof best.rule>} */ (best.rule).target)
        entry = { kind: 'pending', node: compiled.trieWalk(0, target.slice(0, -fj)), x: fi }
        break
      }
      // 同一列（只動查詢的轉移）留在同一份（交界列或 F 列）；換列才改用那一列
      if (fj !== j) {
        cands = cand[fj]
        rowVal = rows[fj]
      }
      i = fi
      j = fj
    }
    steps.reverse()
    return { cost: roundCost(cost), entry, exit, steps }
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
