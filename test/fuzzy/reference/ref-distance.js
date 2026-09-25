/**
 * @file 加權編輯距離的獨立參考實作（測試用的仲裁者）。
 *
 * 直接由 docs/fuzzy-search.md 第 1–2 節的定義寫成，刻意不共用正式實作的任何程式：
 * 不用 `fillRow`、`CompiledRules`、`PathMatcher`，規則以字串直接比對，表格以
 * 「(a, b) 字典序遞增」的順序填（正式實作是逐列、列內依 i），所以兩者不會因為同一個錯誤而一起錯。
 *
 * D(a, b)＝把 X[lo..a) 轉成 Y[0..b) 的最小成本：
 *   D(lo, 0) = 0
 *   D(a, b)  = min { D(a−1, b) + del(X[a−1]),
 *                    D(a, b−1) + ins(Y[b−1]),
 *                    D(a−1, b−1) + sub(X[a−1], Y[b−1]),
 *                    D(a−|s|, b−|t|) + w   對每條規則 s→t（s 恰好是 X 在 a 結尾的子字串、t 恰好是 Y 在 b 結尾的子字串） }
 *
 * 位置限制（規則的 position）：
 * - initial：s 的起點是 X 的詞首，且 t 的起點是 Y 的詞首
 * - final：s 的終點是 X 的詞尾，且 t 的終點是 Y 的詞尾
 * X 側「詞首／詞尾」由呼叫端的判斷函式決定（預設：視窗兩端與邊界字元旁），讓同一個參考實作
 * 也能當作邊界條件 DP（start／end 向量）與構詞搜尋各段的仲裁。
 */

/**
 * @typedef {object} RefRule
 * @property {string[]} source
 * @property {string[]} target
 * @property {number} weight
 * @property {'any' | 'initial' | 'final'} position
 */

/**
 * 由 WeightedEditDistance 取出參考實作需要的資料（規則以 RuleSet 展開，不經過 CompiledRules）。
 * @param {import('../../../src/fuzzy/distance.js').WeightedEditDistance} metric
 */
export function refContext(metric) {
  /** @type {RefRule[]} */
  const rules = metric.ruleSet.expand(metric.normalize).map((r) => ({
    source: Array.from(r.source),
    target: Array.from(r.target),
    weight: r.weight,
    position: r.position,
  }))
  return { rules, costs: metric.costs, boundaries: metric.boundaries }
}

/**
 * @typedef {object} RefOptions
 * @property {number} [lo=0] X 的視窗起點
 * @property {number} [hi=x.length] X 的視窗終點（不含）
 * @property {(p: number) => boolean} [xInitial] X 的位置 p 是否算詞首（預設：p = lo 或 X[p−1] 是邊界）
 * @property {(p: number) => boolean} [xFinal] X 的位置 p 是否算詞尾（預設：p = hi 或 X[p] 是邊界）
 */

/**
 * 把 X[lo..hi) 轉成 Y 的最小成本（不四捨五入，保留浮點累加的原值）。
 * @param {ReturnType<typeof refContext>} ctx
 * @param {string[]} x
 * @param {string[]} y
 * @param {RefOptions} [options]
 * @returns {number}
 */
export function refDistance(ctx, x, y, options = {}) {
  const { rules, costs, boundaries } = ctx
  const lo = options.lo ?? 0
  const hi = options.hi ?? x.length
  const m = y.length
  const isB = (/** @type {string | undefined} */ ch) => ch !== undefined && boundaries.has(ch)
  const xInitial = options.xInitial ?? ((p) => p === lo || isB(x[p - 1]))
  const xFinal = options.xFinal ?? ((p) => p === hi || isB(x[p]))
  const yInitial = (/** @type {number} */ b) => b === 0 || isB(y[b - 1])
  const yFinal = (/** @type {number} */ b) => b === m || isB(y[b])
  /** 從 end 往前比對：arr[end−len..end) 是否等於 pattern @param {string[]} arr */
  const endsWith = (arr, end, pattern, floor) => {
    if (end - pattern.length < floor) return false
    for (let k = 0; k < pattern.length; k++) if (arr[end - pattern.length + k] !== pattern[k]) return false
    return true
  }

  const width = m + 1
  const D = new Array((hi - lo + 1) * width).fill(Infinity)
  const at = (/** @type {number} */ a, /** @type {number} */ b) => (a - lo) * width + b
  D[at(lo, 0)] = 0
  for (let a = lo; a <= hi; a++) {
    for (let b = 0; b <= m; b++) {
      if (a === lo && b === 0) continue
      let best = Infinity
      if (a > lo) best = Math.min(best, D[at(a - 1, b)] + costs.del(x[a - 1]))
      if (b > 0) best = Math.min(best, D[at(a, b - 1)] + costs.ins(y[b - 1]))
      if (a > lo && b > 0) best = Math.min(best, D[at(a - 1, b - 1)] + costs.sub(x[a - 1], y[b - 1]))
      for (const r of rules) {
        if (!endsWith(x, a, r.source, lo) || !endsWith(y, b, r.target, 0)) continue
        const a0 = a - r.source.length
        const b0 = b - r.target.length
        if (r.position === 'initial' && !(xInitial(a0) && yInitial(b0))) continue
        if (r.position === 'final' && !(xFinal(a) && yFinal(b))) continue
        best = Math.min(best, D[at(a0, b0)] + r.weight)
      }
      D[at(a, b)] = best
    }
  }
  return D[at(hi, m)]
}
