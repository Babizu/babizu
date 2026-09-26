/**
 * @file 整個詞的聯合對齊：BCDP 模型定義的獨立參考實作（測試用的仲裁者）。
 *
 * 直接由 docs/bcdp.md 1.2–1.3 的定義寫成：查詢 X 對齊到底層字串 U（詞素以交界分開），
 * 規則以字串直接比對，不用 fillRow、CompiledRules、PathMatcher、詞圖或交界狀態。
 *
 * D(a, b)＝把 X[0..a) 轉成 U[0..b) 的最小成本，轉移與 ref-distance.js 相同（刪除、插入、替換、規則），
 * 另加上詞素交界的語意。記 J 為交界位置的集合（0 ≤ J ≤ |U|；重疊的變體中，詞幹開頭是「重疊部分｜詞幹」
 * 的交界，即使它在 U 的位置 0），S ＝ [s0, s1) 為詞幹在 U 上的範圍：
 *
 * 1. 位置規則（initial／final）：target 的起點（終點）在 J 上時直接適用；否則照舊要求 X、U 兩側都在詞首（詞尾）
 * 2. 構詞音變（junction）：initial 要求 target 起點在 J 上、final 要求終點在 J 上、any 要求任一端在 J 上
 * 3. target 的範圍 (b0, b) 內嚴格包含的交界至多一個；包含交界的（跨界）只能是沒有位置限制的方言規則
 * 4. 空白（X 的邊界字元）只能由詞幹內的操作消耗：U 範圍 ⊆ S 的操作，或位置在 [s0, s1] 且不在 J 上的「只動 X」操作
 * 5. 交界欄 b ∈ J 上的格子，X 的位置不能在空白旁
 * 6. 固定的交界（中綴、重疊的變體）：對齊必須經過指定的格子，而且不能被規則跨越
 *    - pinIn ＝ {b, a}：經過 (a, b)
 *    - pinOut ＝ {b, allowed}：經過某個 (a', b)，a' ∈ allowed
 *
 * 表格依欄（b）由左而右、欄內依 a 遞增填寫：每個轉移的來源都在較早的欄，或同一欄較小的 a。
 * 「經過 (a, b)」＝這一欄先照常算完，只留 (a, b)，再由它沿著同一欄做「只動 X」的操作。
 */

/**
 * @typedef {object} JointOptions
 * @property {number[]} [junctions] 交界位置
 * @property {[number, number]} [stem] 詞幹在 U 上的範圍 [s0, s1)（預設整個 U）
 * @property {{b: number, a: number} | null} [pinIn]
 * @property {{b: number, allowed: Set<number>} | null} [pinOut]
 */

/**
 * @param {ReturnType<typeof refJointContext>} ctx
 * @param {string[]} x 查詢
 * @param {string[]} u 底層字串
 * @param {JointOptions} [options]
 * @returns {number}
 */
export function refJoint(ctx, x, u, options = {}) {
  const { rules, costs, boundaries } = ctx
  const n = x.length
  const m = u.length
  const J = new Set(options.junctions ?? [])
  const junctionList = [...J].sort((p, q) => p - q)
  const [s0, s1] = options.stem ?? [0, m]
  const pins = [
    ...(options.pinIn ? [{ b: options.pinIn.b, allowed: new Set([options.pinIn.a]) }] : []),
    ...(options.pinOut ? [options.pinOut] : []),
  ]
  const isB = (/** @type {string | undefined} */ ch) => ch !== undefined && boundaries.has(ch)
  const xInitial = (/** @type {number} */ a) => a === 0 || isB(x[a - 1])
  const xFinal = (/** @type {number} */ a) => a === n || isB(x[a])
  const uInitial = (/** @type {number} */ b) => b === 0 || isB(u[b - 1])
  const uFinal = (/** @type {number} */ b) => b === m || isB(u[b])
  // 前綴和（只是為了快；定義不變）：X 前 a 個字元中的空白數、U 前 b 個位置中的交界數
  const spaces = [0]
  for (let a = 0; a < n; a++) spaces.push(spaces[a] + (isB(x[a]) ? 1 : 0))
  const seams = [0]
  for (let b = 0; b <= m; b++) seams.push(seams[b] + (J.has(b) ? 1 : 0))
  /** X[a0..a) 含有空白 */
  const spends = (/** @type {number} */ a0, /** @type {number} */ a) => spaces[a] - spaces[a0] > 0
  /** 範圍 (b0, b) 內嚴格包含幾個交界：位置 b0 + 1 … b − 1 */
  const inside = (/** @type {number} */ b0, /** @type {number} */ b) => (b - b0 >= 2 ? seams[b] - seams[b0 + 1] : 0)
  void junctionList
  /** 一個操作是否合法（與規則種類無關的部分）：X 範圍 [a0, a)、U 範圍 [b0, b) */
  const legal = (/** @type {number} */ a0, /** @type {number} */ a, /** @type {number} */ b0, /** @type {number} */ b) => {
    for (const pin of pins) if (b0 < pin.b && pin.b < b) return false // 固定的交界不能被跨越
    if (spends(a0, a)) {
      // 空白只能在詞幹內消耗；交界上只動 X 的操作不能消耗空白
      if (b0 === b) {
        if (!(b >= s0 && b <= s1 && !J.has(b))) return false
      } else if (!(b0 >= s0 && b <= s1)) return false
    }
    return true
  }
  const endsWith = (/** @type {string[]} */ arr, /** @type {number} */ end, /** @type {string[]} */ pattern) => {
    if (end - pattern.length < 0) return false
    for (let k = 0; k < pattern.length; k++) if (arr[end - pattern.length + k] !== pattern[k]) return false
    return true
  }
  // 每條規則：X 在哪些位置以 source 結尾、U 在哪些位置以 target 結尾（先算好）
  const xMatch = rules.map((r) => Array.from({ length: n + 1 }, (_, a) => endsWith(x, a, r.source)))
  const uMatch = rules.map((r) => Array.from({ length: m + 1 }, (_, b) => endsWith(u, b, r.target)))

  /** @type {Float64Array[]} D[b][a] */
  const D = Array.from({ length: m + 1 }, () => new Float64Array(n + 1).fill(Infinity))
  /**
   * 第 b 欄的第 a 格。onlyXOps：只考慮「同一欄、只動 X」的轉移（刪除、target 為空的規則），
   * 用於「經過 (a, b)」之後沿著同一欄繼續。
   */
  const cell = (/** @type {number} */ a, /** @type {number} */ b, /** @type {boolean} */ onlyXOps) => {
    let best = !onlyXOps && a === 0 && b === 0 ? 0 : Infinity
    if (a > 0 && legal(a - 1, a, b, b)) best = Math.min(best, D[b][a - 1] + costs.del(x[a - 1]))
    if (!onlyXOps && b > 0 && legal(a, a, b - 1, b)) best = Math.min(best, D[b - 1][a] + costs.ins(u[b - 1]))
    if (!onlyXOps && a > 0 && b > 0 && legal(a - 1, a, b - 1, b)) best = Math.min(best, D[b - 1][a - 1] + costs.sub(x[a - 1], u[b - 1]))
    for (let ri = 0; ri < rules.length; ri++) {
      const r = rules[ri]
      if (onlyXOps && r.target.length > 0) continue
      if (!xMatch[ri][a] || !uMatch[ri][b]) continue
      const a0 = a - r.source.length
      const b0 = b - r.target.length
      if (a0 === a && b0 === b) continue
      if (!legal(a0, a, b0, b)) continue
      const crossing = inside(b0, b)
      if (crossing > 1) continue
      if (crossing === 1 && (r.position !== 'any' || r.junction)) continue
      if (r.junction) {
        if (r.position === 'initial' && !J.has(b0)) continue
        if (r.position === 'final' && !J.has(b)) continue
        if (r.position === 'any' && !J.has(b0) && !J.has(b)) continue
      } else {
        if (r.position === 'initial' && !(J.has(b0) || (uInitial(b0) && xInitial(a0)))) continue
        if (r.position === 'final' && !(J.has(b) || (uFinal(b) && xFinal(a)))) continue
      }
      best = Math.min(best, D[b0][a0] + r.weight)
    }
    // 交界欄上，X 的位置不能在空白旁
    if (J.has(b) && ((a > 0 && isB(x[a - 1])) || (a < n && isB(x[a])))) best = Infinity
    return best
  }

  for (let b = 0; b <= m; b++) {
    for (let a = 0; a <= n; a++) D[b][a] = cell(a, b, false)
    for (const pin of pins) {
      if (pin.b !== b) continue
      // 經過 (a', b)，a' ∈ allowed：只留這些格，再沿同一欄做只動 X 的操作
      for (let a = 0; a <= n; a++) {
        const kept = pin.allowed.has(a) ? D[b][a] : Infinity
        D[b][a] = kept
        D[b][a] = Math.min(kept, cell(a, b, true))
      }
    }
  }
  return D[m][n]
}

/**
 * 參考實作需要的規則與成本（規則以 RuleSet 展開，不經過 CompiledRules），規則帶 junction 欄位。
 * @param {import('../../../src/fuzzy/distance.js').WeightedEditDistance} metric
 */
export function refJointContext(metric) {
  const rules = metric.ruleSet.expand(metric.normalize).map((r) => ({
    source: Array.from(r.source),
    target: Array.from(r.target),
    weight: r.weight,
    position: r.position,
    junction: r.junction,
  }))
  return { rules, costs: metric.costs, boundaries: metric.boundaries }
}
