/**
 * @file 詞條家族（search 引擎的 EntryGroup，見 babizu/search 的 family.js）的顯示輔助。
 */

/**
 * 一列要顯示的命中：本身與併進這一列的另立條目中，分數最好的一個；都沒有命中則為 null。
 * @param {{hit: any, also: Array<{hit: any}>}} node
 */
export function displayHit(node) {
  let best = node.hit
  for (const a of node.also) if (a.hit && (!best || a.hit.score < best.score)) best = a.hit
  return best
}

/** 家族是否只有一筆（顯示成一般的詞條列，不需要樹狀排列） @param {{root: any}} group */
export const isSingle = (group) => group.root.children.length === 0 && group.root.also.length === 0

/**
 * 同一層先顯示幾項：前幾項依子樹中最好的分數排序，重要的在前面；
 * 只多出一項時直接全部顯示，不要出現「再顯示 1 項」。
 * @param {number} count 這一層的項目數
 * @param {number} depth 第幾層（0 是詞條底下的第一層）
 */
export function visibleCount(count, depth) {
  const limit = depth === 0 ? 4 : 3
  return count <= limit + 1 ? count : limit
}
