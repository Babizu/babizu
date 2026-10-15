/**
 * @file 搜尋方法的統計與排除（介面的篩選面板）：詞條與例句共用。
 */

import { methodOf, SEARCH_METHOD_GROUPS, SEARCH_METHODS, type MatchType, type SearchMethod, type SearchMethodGroup } from './scoring.ts'
import type { SearchResponse } from './types.ts'

/**
 * 每種搜尋方法找得到哪些記錄（數量給介面顯示，不受排除影響），以及命中是否因為方法被排除而略過。
 */
export class MethodTally {
  private readonly exclude: ReadonlySet<string>
  private readonly byMethod = new Map<SearchMethod, Set<number>>(SEARCH_METHODS.map((m) => [m, new Set()]))

  constructor(exclude: ReadonlySet<string>) {
    this.exclude = exclude
  }

  /** 記下記錄 k 可以由這個方法找到 */
  count(k: number, method: SearchMethod): void {
    this.byMethod.get(method)?.add(k)
  }

  isExcluded(method: SearchMethod): boolean {
    return this.exclude.has(method)
  }

  /** 記下一個命中的方法，回傳是否保留（方法沒有被排除） */
  admit(k: number, hit: { matchType: MatchType; distance: number; kind?: string }): boolean {
    const method = methodOf(hit)
    this.count(k, method)
    return !this.isExcluded(method)
  }

  /** 寫進回應：每種方法與每組方法的記錄數（一筆記錄可能同時屬於好幾種方法，組的數量取聯集） */
  writeTo(response: Pick<SearchResponse, 'methods' | 'methodGroups'>): void {
    for (const [m, docs] of this.byMethod) response.methods[m] = docs.size
    for (const [g, ms] of Object.entries(SEARCH_METHOD_GROUPS)) {
      const union = new Set(ms.flatMap((m) => [...(this.byMethod.get(m) as Set<number>)]))
      response.methodGroups[g as SearchMethodGroup] = union.size
    }
  }
}
