/**
 * @file 廣義加權編輯距離的動態規劃核心。
 *
 * 本檔是整個函式庫「唯一」實作狀態轉移的地方：兩字串的距離計算（distance.js）、
 * 解釋模式（explain）、詞圖模糊搜尋（fuzzy-index.js）都呼叫同一個 `fillRow`，
 * 以保證三者的結果永遠一致。
 *
 * ## 記號
 * - X：查詢字串（長度 N），Y：候選字串（長度 M），皆為 code point 陣列
 * - D(i, j)：把 X 的前 i 個字元轉成 Y 的前 j 個字元的最小成本
 * - 「第 j 列」：固定 j、i = 0..N 的一整列。詞圖往下走一層就是多算一列。
 *
 * ## 轉移
 * D(i, j) = min {
 *   D(i-1, j)   + del(X[i-1])                 刪除
 *   D(i, j-1)   + ins(Y[j-1])                 插入
 *   D(i-1, j-1) + sub(X[i-1], Y[j-1])         替換（相同字元為 0）
 *   D(i-|s|, j-|t|) + w   對每條匹配的規則 s→t 規則
 * }
 *
 * ## 位置限制與「詞尾列」
 * - initial：s 位於 X 的詞首，且 t 位於 Y 的詞首（前一字元不存在或是邊界字元）
 * - final：s 位於 X 的詞尾，且 t 位於 Y 的詞尾（後一字元不存在或是邊界字元）
 *
 * X 側的條件在 `compileQuery` 時就能確定。Y 側的 initial 條件只需往回看，也能確定。
 * 但 Y 側的 final 條件要看「下一個字元」——在詞圖裡同一個節點可能有好幾條出邊，
 * 下一個字元並不唯一。因此 `fillRow` 以 `allowFinal` 參數區分兩種假設：
 * - allowFinal = false：假設 Y[j] 存在且不是邊界（列 N_j）
 * - allowFinal = true ：假設 Y[j] 不存在或是邊界（列 F_j），此時才允許 final 規則
 * 往後的列引用第 j 列時，依實際的 Y[j] 選用正確的那一列。
 */

/** 浮點誤差容忍值：0.1 累加三次會得到 0.30000000000000004 */
export const EPSILON = 1e-9

/**
 * 把成本四捨五入到 1e-9，消除浮點累加誤差，方便比較與顯示。
 * @param {number} x
 */
export function roundCost(x) {
  return Number.isFinite(x) ? Math.round(x * 1e9) / 1e9 : x
}

/**
 * @typedef {import('./rules.js').Rule & {sourceLength: number, targetLength: number}} CompiledRule
 */

/**
 * @typedef {object} QueryPlan 針對單一查詢字串預先算好的規則匹配表
 * @property {string[]} chars 查詢字串 X
 * @property {Array<Map<string, CompiledRule[]> | null>} at
 *   at[i]：所有「source 恰好是 X 在位置 i 結尾的後綴、且 X 側位置條件成立」的規則，
 *   以 target 字串分組。DP 計算時只要拿 Y 的後綴去查這張雜湊表即可。
 * @property {boolean} hasFinal 是否有任何 final 規則匹配到 X（沒有的話 F_j 恆等於 N_j）
 * @property {ColumnContext} column 計算列時重複使用的暫存
 */

/**
 * 規則的雜湊索引。建立一次後可重複用於任意查詢。
 */
export class CompiledRules {
  /**
   * @param {import('./rules.js').Rule[]} rules 已正規化、已展開反向的規則
   * @param {Set<string>} boundaries 詞邊界字元（預設為空白）
   */
  constructor(rules, boundaries) {
    this.boundaries = boundaries
    /** @type {CompiledRule[]} */
    this.rules = rules.map((r) => ({
      ...r,
      sourceLength: Array.from(r.source).length,
      targetLength: Array.from(r.target).length,
    }))
    /** @type {Map<string, CompiledRule[]>} 以 source 字串為鍵 */
    this.bySource = new Map()
    for (const rule of this.rules) {
      const list = this.bySource.get(rule.source)
      if (list) list.push(rule)
      else this.bySource.set(rule.source, [rule])
    }
    /** 出現過的 source 長度（遞增） */
    this.sourceLengths = uniqueSorted(this.rules.map((r) => r.sourceLength))
    /** 出現過的 target 長度（遞增） */
    this.targetLengths = uniqueSorted(this.rules.map((r) => r.targetLength))
    /** 最長的 target 長度；一次轉移最多跨越的列數，決定剪枝要看幾列 */
    this.maxTargetLength = Math.max(1, ...this.targetLengths)
    /**
     * 「跨列」剪枝表：鍵為某條規則 target 的「真前綴」（長度 1 … |target|-1），
     * 值為所有以此為前綴的規則中最小的權重。
     * 詞圖搜尋時，第 r 列（r < j）要跨過第 j 列，唯一的方式是一條 target 以
     * path[r..j) 開頭、且比它更長的規則；查不到就代表第 r 列無法跨過第 j 列。
     * @type {Map<string, number>}
     */
    this.jumpWeights = new Map()
    for (const rule of this.rules) {
      const chars = Array.from(rule.target)
      for (let p = 1; p < chars.length; p++) {
        const prefix = chars.slice(0, p).join('')
        const prev = this.jumpWeights.get(prefix)
        if (prev === undefined || rule.weight < prev) this.jumpWeights.set(prefix, rule.weight)
      }
    }
  }

  /** @param {string | undefined} ch */
  isBoundary(ch) {
    return ch !== undefined && this.boundaries.has(ch)
  }

  /**
   * 為查詢字串建立規則匹配表。
   * @param {string[]} x 查詢字串（code point 陣列）
   * @returns {QueryPlan}
   */
  compileQuery(x) {
    const n = x.length
    /** @type {Array<Map<string, CompiledRule[]> | null>} */
    const at = new Array(n + 1).fill(null)
    let hasFinal = false

    for (let i = 0; i <= n; i++) {
      for (const a of this.sourceLengths) {
        if (a > i) break
        const key = a === 0 ? '' : x.slice(i - a, i).join('')
        const candidates = this.bySource.get(key)
        if (!candidates) continue
        for (const rule of candidates) {
          if (rule.position === 'initial' && !(i - a === 0 || this.isBoundary(x[i - a - 1]))) continue
          if (rule.position === 'final' && !(i === n || this.isBoundary(x[i]))) continue
          if (rule.position === 'final') hasFinal = true
          let byTarget = at[i]
          if (!byTarget) byTarget = at[i] = new Map()
          const list = byTarget.get(rule.target)
          if (list) list.push(rule)
          else byTarget.set(rule.target, [rule])
        }
      }
    }
    const lengthSlots = this.targetLengths.length
    return {
      chars: x,
      at,
      hasFinal,
      column: {
        j: 0,
        yChar: '',
        prevRow: null,
        suffix: new Array(this.maxTargetLength + 1).fill(null),
        keys: new Array(lengthSlots).fill(null),
        atInitial: new Array(lengthSlots).fill(false),
        rows: new Array(lengthSlots).fill(null),
      },
    }
  }
}

/**
 * @typedef {'match' | 'substitute' | 'delete' | 'insert' | 'rule'} Operation
 */

/**
 * @typedef {object} Transition fillRow 在追蹤模式下回報的每一個候選轉移
 * @property {number} i
 * @property {number} j
 * @property {number} fromI
 * @property {number} fromJ
 * @property {number} cost 到達 (i, j) 的總成本
 * @property {number} stepCost 這一步本身的成本
 * @property {Operation} op
 * @property {CompiledRule | null} rule
 */

/**
 * @typedef {object} ColumnContext
 * 計算第 j 列所需、與 allowFinal 無關的準備資料。N_j 與 F_j 共用同一份，只準備一次。
 * 物件本身存放在 QueryPlan 上重複使用（fillRow 不會遞迴，所以不會互相覆寫）。
 * @property {number} j
 * @property {string} yChar Y[j-1]（j = 0 時為空字串）
 * @property {Float64Array | null} prevRow 第 j-1 列的實際數值
 * @property {Array<string | null>} suffix suffix[t]：Y 在位置 j 結尾、長度 t 的後綴（t > j 時為 null）
 * @property {Array<string | null>} keys keys[k]：對應 compiled.targetLengths[k] 的後綴
 * @property {boolean[]} atInitial atInitial[k]：該後綴是否位於 Y 的詞首
 * @property {Array<Float64Array | null>} rows rows[k]：規則轉移的來源列（target 長度 0 時為 null，代表同一列）
 */

/**
 * 準備第 j 列的共用資料。
 * @param {QueryPlan} plan
 * @param {CompiledRules} compiled
 * @param {string[]} y 候選字串的路徑（至少要有前 j 個字元）
 * @param {number} j
 * @param {(row: number) => Float64Array} rowAt 取得先前第 row 列（row < j）的「實際」數值
 * @returns {ColumnContext}
 */
export function prepareColumn(plan, compiled, y, j, rowAt) {
  const ctx = plan.column
  ctx.j = j
  ctx.yChar = j > 0 ? y[j - 1] : ''
  ctx.prevRow = j > 0 ? rowAt(j - 1) : null

  // 由短到長逐字往前串，避免每個長度都 slice + join
  let s = ''
  ctx.suffix[0] = ''
  for (let t = 1; t < ctx.suffix.length; t++) {
    if (t <= j) {
      s = y[j - t] + s
      ctx.suffix[t] = s
    } else {
      ctx.suffix[t] = null
    }
  }

  const lengths = compiled.targetLengths
  for (let k = 0; k < lengths.length; k++) {
    const t = lengths[k]
    const ok = t <= j
    ctx.keys[k] = ok ? ctx.suffix[t] : null
    ctx.atInitial[k] = ok && (j - t === 0 || compiled.isBoundary(y[j - t - 1]))
    ctx.rows[k] = ok && t > 0 ? rowAt(j - t) : null
  }
  return ctx
}

/**
 * 計算第 j 列。
 *
 * @param {QueryPlan} plan 查詢的規則匹配表
 * @param {CompiledRules} compiled
 * @param {import('./costs.js').CostModel} costs
 * @param {ColumnContext} ctx prepareColumn 的結果
 * @param {boolean} allowFinal 是否假設 Y 在位置 j 是詞尾（見檔頭說明）
 * @param {Float64Array} out 輸出，長度 N + 1
 * @param {((t: Transition) => void) | null} [trace] 追蹤模式：回報每個候選轉移（視覺化用）
 */
export function fillRow(plan, compiled, costs, ctx, allowFinal, out, trace = null) {
  const x = plan.chars
  const n = x.length
  const { j, yChar, prevRow, keys, atInitial, rows } = ctx
  const lengths = compiled.targetLengths
  const insertCost = prevRow ? costs.ins(yChar) : 0

  for (let i = 0; i <= n; i++) {
    // 起點 D(0, 0) = 0；其餘格子由轉移取最小值
    let best = i === 0 && j === 0 ? 0 : Infinity

    if (prevRow) {
      // 插入 Y[j-1]
      const c1 = prevRow[i] + insertCost
      if (c1 < best) best = c1
      if (trace) trace({ i, j, fromI: i, fromJ: j - 1, cost: c1, stepCost: insertCost, op: 'insert', rule: null })

      // 替換／相同
      if (i > 0) {
        const subCost = costs.sub(x[i - 1], yChar)
        const c2 = prevRow[i - 1] + subCost
        if (c2 < best) best = c2
        if (trace) {
          const op = x[i - 1] === yChar ? 'match' : 'substitute'
          trace({ i, j, fromI: i - 1, fromJ: j - 1, cost: c2, stepCost: subCost, op, rule: null })
        }
      }
    }

    // 刪除 X[i-1]（同一列、較小的 i，已算好）
    if (i > 0) {
      const deleteCost = costs.del(x[i - 1])
      const c3 = out[i - 1] + deleteCost
      if (c3 < best) best = c3
      if (trace) trace({ i, j, fromI: i - 1, fromJ: j, cost: c3, stepCost: deleteCost, op: 'delete', rule: null })
    }

    // 語音對應規則：用 Y 的後綴查 at[i] 雜湊表
    const byTarget = plan.at[i]
    if (byTarget) {
      for (let k = 0; k < lengths.length; k++) {
        const key = keys[k]
        if (key === null) continue
        const rules = byTarget.get(key)
        if (!rules) continue
        // target 長度為 0（脫落規則）時來源在同一列
        const predRow = rows[k] ?? out
        for (const rule of rules) {
          if (rule.position === 'final' && !allowFinal) continue
          if (rule.position === 'initial' && !atInitial[k]) continue
          const c4 = predRow[i - rule.sourceLength] + rule.weight
          if (c4 < best) best = c4
          if (trace) {
            trace({
              i,
              j,
              fromI: i - rule.sourceLength,
              fromJ: j - rule.targetLength,
              cost: c4,
              stepCost: rule.weight,
              op: 'rule',
              rule,
            })
          }
        }
      }
    }

    out[i] = best
  }
}

/** @param {number[]} values */
function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b)
}
