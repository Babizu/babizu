/**
 * @file 模糊搜尋的核心演算法：方言規則（BCDP，預設）或對應組檢索（實驗性，站台設定了 csr 才有；docs/csr.md）。
 * 是讀者的偏好，與外觀、介面語言一樣放在右上角的設定選單，存在 localStorage（鍵以站台代號為前綴）。
 * 只換「一個查詢詞找到哪些詞」的核心，搜尋條件與結果的呈現都不變。
 */

import { computed, ref, watch } from 'vue'
import site from 'virtual:babizu/site'

export type SearchAlgorithm = 'bcdp' | 'csr'

const STORAGE_KEY = `${site.id}:algorithm`

function initial(): SearchAlgorithm {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'csr' ? 'csr' : 'bcdp'
  } catch {
    // 無法使用 localStorage（隱私模式等）時照常運作
    return 'bcdp'
  }
}

const stored = ref<SearchAlgorithm>(initial())
watch(stored, (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // 同上
  }
})

/** 實際用的演算法：站台沒有對應組檢索時一律是 bcdp */
const algorithm = computed<SearchAlgorithm>(() => (site.csr ? stored.value : 'bcdp'))

export function useSearchAlgorithm() {
  return {
    algorithm,
    /** 站台有沒有對應組檢索（沒有時設定選單不顯示這一項） */
    available: site.csr,
    setAlgorithm: (value: SearchAlgorithm) => {
      stored.value = value
    },
  }
}
