/**
 * @file 最近的搜尋（存在瀏覽器本機，最多 8 筆）。
 */

import { useLocalStorage } from '@vueuse/core'
import site from 'virtual:babizu/site'

const MAX = 8
const recent = useLocalStorage(`${site.id}:recent`, /** @type {string[]} */ ([]))

export function useRecentSearches() {
  /** @param {string} query */
  function remember(query) {
    const q = query.trim()
    if (!q) return
    recent.value = [q, ...recent.value.filter((x) => x !== q)].slice(0, MAX)
  }

  function clear() {
    recent.value = []
  }

  return { recent, remember, clear }
}
