/**
 * @file 詞素交界狀態的運算（docs/bcdp.md 第 4 節）。
 *
 * 交界狀態 ＝（交界列 R，跨界表）：R[x] 是對齊走到（查詢位置 x, 這個交界）的最小成本；
 * 跨界表列出還沒走完的規則 target（trie 節點）與它起點那一列。交界之後的每個轉移只讀這兩樣。
 *
 * DP 在 (min, +) 下是線性的：由幾個狀態出發的最小成本，等於由它們逐項取 min 的狀態出發的成本。
 * 所以不同前綴鏈（後綴鏈）在同一個交界的狀態可以合併成一個（mergeInto），結果精確。
 */

/** @typedef {import('./fuzzy-index.js').JunctionState} JunctionState */
/** @typedef {import('./fuzzy-index.js').JunctionEnd} JunctionEnd */

/**
 * 空的交界狀態（沒有任何對齊能走到這裡）。
 * @param {number} n 查詢長度
 * @returns {JunctionState}
 */
export function emptyJunction(n) {
  return { row: new Float64Array(n + 1).fill(Infinity), pending: [] }
}

/**
 * 把 state 逐項取 min 合併進 into（in place）。每一格記下是哪一個來源（tag）取得最小值，
 * 讓說明時能找回是哪一條詞綴鏈；同分時保留先合併的（strict <），除非給了 before：
 * 同分時 before(新的 tag, 原來的 tag) 為真就換成新的（說明依規格的順序選，成本不受影響）。
 * @param {JunctionState & {tags?: {row: unknown[], pending: Map<number, unknown[]>}}} into
 * @param {JunctionState} state
 * @param {number} add 合併前加在所有值上的成本（例如詞綴本身的成本）
 * @param {unknown} tag
 * @param {(tag: any, current: any) => boolean} [before]
 */
export function mergeInto(into, state, add, tag, before) {
  into.tags ??= { row: new Array(into.row.length).fill(null), pending: new Map() }
  const n = into.row.length
  for (let x = 0; x < n; x++) {
    const v = state.row[x] + add
    if (v < into.row[x] || (v === into.row[x] && v < Infinity && before?.(tag, into.tags.row[x]))) {
      into.row[x] = v
      into.tags.row[x] = tag
    }
  }
  for (const p of state.pending) {
    let target = into.pending.find((q) => q.node === p.node)
    if (!target) {
      target = { node: p.node, row: new Float64Array(n).fill(Infinity) }
      into.pending.push(target)
      into.tags.pending.set(p.node, new Array(n).fill(null))
    }
    const tags = /** @type {unknown[]} */ (into.tags.pending.get(p.node))
    for (let x = 0; x < n; x++) {
      const v = p.row[x] + add
      if (v < target.row[x] || (v === target.row[x] && v < Infinity && before?.(tag, tags[x]))) {
        target.row[x] = v
        tags[x] = tag
      }
    }
  }
  return into
}

/**
 * 交界狀態裡最小的值（剪枝用：之後的成本只會更大）。
 * @param {JunctionState} state
 */
export function minOf(state) {
  let min = Math.min(...state.row)
  for (const p of state.pending) min = Math.min(min, ...p.row)
  return min
}

/**
 * 每個值加上 c 的複本（例如詞綴本身的成本）。
 * @param {JunctionState} state
 * @param {number} c
 * @returns {JunctionState}
 */
export function shifted(state, c) {
  return {
    row: Float64Array.from(state.row, (v) => v + c),
    pending: state.pending.map((p) => ({ node: p.node, row: Float64Array.from(p.row, (v) => v + c) })),
  }
}

/**
 * 空的詞尾耦合狀態。
 * @param {number} n
 * @returns {JunctionEnd & {tags: {row: unknown[], pending: Map<string, unknown[]>}}}
 */
export function emptyEnd(n) {
  return { row: new Float64Array(n + 1).fill(Infinity), pending: [], word: null, tags: { row: new Array(n + 1).fill(null), pending: new Map() } }
}

/**
 * 把一個詞尾耦合狀態逐項取 min 合併進 into（跨界表以 tail 字串對應），並記下每一格來自哪一個 tag。
 * @param {ReturnType<typeof emptyEnd>} into
 * @param {JunctionEnd} end
 * @param {unknown} tag
 */
export function mergeEndInto(into, end, tag) {
  const n = into.row.length
  if (end.row) {
    for (let x = 0; x < n; x++) {
      if (end.row[x] < into.row[x]) {
        into.row[x] = end.row[x]
        into.tags.row[x] = tag
      }
    }
  }
  for (const p of end.pending) {
    const key = p.tail.join('')
    let target = into.pending.find((q) => q.tail.join('') === key)
    if (!target) {
      target = { tail: p.tail, row: new Float64Array(n).fill(Infinity) }
      into.pending.push(target)
      into.tags.pending.set(key, new Array(n).fill(null))
    }
    const tags = /** @type {unknown[]} */ (into.tags.pending.get(key))
    for (let x = 0; x < n; x++) {
      if (p.row[x] < target.row[x]) {
        target.row[x] = p.row[x]
        tags[x] = tag
      }
    }
  }
  return into
}

/**
 * 是否有任何有限值。
 * @param {JunctionState} state
 */
export function isReachable(state) {
  return state.row.some((v) => v < Infinity) || state.pending.some((p) => p.row.some((v) => v < Infinity))
}

/**
 * 反方向（鏡像距離函式、反轉的查詢）算出的交界狀態，換成正向詞尾耦合用的 JunctionEnd。
 * - 反向座標的位置 x′ ＝ n − x
 * - 鏡像 trie 的節點代表反轉的字串；正向規則 target 的後半段 tail ＝ 把它反轉回來
 * @param {JunctionState} state 反向的交界狀態
 * @param {import('./dp.js').CompiledRules} mirrorCompiled 鏡像距離函式的規則
 * @returns {JunctionEnd}
 */
export function toForwardEnd(state, mirrorCompiled) {
  const flip = (/** @type {Float64Array} */ row) => Float64Array.from(row).reverse()
  return {
    row: flip(state.row),
    pending: state.pending.map((p) => ({ tail: Array.from(mirrorCompiled.trieString(p.node)).reverse(), row: flip(p.row) })),
  }
}

/**
 * 只保留交界列的某些位置（其他為 ∞），並去掉跨界表：還原變體的交界固定在查詢的位置上，不能被規則跨越。
 * @param {Float64Array} row
 * @param {(x: number) => boolean} keep
 * @param {number} [add=0]
 * @returns {Float64Array}
 */
export function pinned(row, keep, add = 0) {
  return Float64Array.from(row, (v, x) => (keep(x) ? v + add : Infinity))
}
