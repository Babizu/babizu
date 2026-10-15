/**
 * @file 詞條家族（babizu/search 的 EntryGroup，見 family.ts）的顯示輔助。
 */

import type { EntryGroup, EntryHit, EntryNode } from '@babizu/search/index.ts'

/**
 * 一列要顯示的命中：本身與併進這一列的另立條目中，分數最好的一個；都沒有命中則為 null。
 */
export function displayHit(node: Pick<EntryNode, 'hit' | 'also'>): EntryHit | null {
  let best = node.hit
  for (const a of node.also) if (a.hit && (!best || a.hit.score < best.score)) best = a.hit
  return best
}

/** 家族是否只有一筆（顯示成一般的詞條列，不需要樹狀排列） */
export const isSingle = (group: Pick<EntryGroup, 'root'>) => group.root.children.length === 0 && group.root.also.length === 0

/**
 * 同一層先顯示幾項：前幾項依子樹中最好的分數排序，重要的在前面；
 * 只多出一項時直接全部顯示，不要出現「再顯示 1 項」。
 * @param count 這一層的項目數
 * @param depth 第幾層（0 是詞條底下的第一層）
 */
export function visibleCount(count: number, depth: number): number {
  const limit = depth === 0 ? 4 : 3
  return count <= limit + 1 ? count : limit
}
