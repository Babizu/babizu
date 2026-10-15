/**
 * @file 篩選條件（來源、方言、記錄單位、狀態）→ 記錄是否保留。一般搜尋、清單與句型搜尋共用。
 */

import type { SearchDocs } from './format.ts'
import type { SearchFilters } from './types.ts'

/** 依篩選條件建立「記錄 k 是否保留」的函式；沒有指定的條件不篩。 */
export function createDocFilter(docs: SearchDocs, { sources, dialects, units, statuses }: SearchFilters = {}): (k: number) => boolean {
  const sourceSet = sources?.length ? new Set(sources.map((s) => docs.sources.indexOf(s))) : null
  const unitSet = units?.length ? new Set(units.map((u) => docs.units.indexOf(u))) : null
  const statusSet = statuses?.length ? new Set(statuses.map((s) => docs.statuses.indexOf(s))) : null
  let dialectMask = 0
  let allowNone = false
  for (const d of dialects ?? []) {
    if (d === 'none') allowNone = true
    // 勾一個變體，連它包含的下層變體一起納入（例如巴宰 ⊇ 愛蘭；包含關係來自站台設定）
    for (const code of docs.dialectSupersets?.[d] ?? [d]) {
      const bit = docs.dialects.indexOf(code)
      if (bit >= 0) dialectMask |= 1 << bit
    }
  }
  const filterDialects = (dialects?.length ?? 0) > 0

  return (k) => {
    if (sourceSet && !sourceSet.has(docs.source[k])) return false
    if (unitSet && !unitSet.has(docs.unit[k])) return false
    if (statusSet && !statusSet.has(docs.status[k])) return false
    if (filterDialects) {
      const mask = docs.dialect[k]
      if (!((mask & dialectMask) !== 0 || (allowNone && mask === 0))) return false
    }
    return true
  }
}
