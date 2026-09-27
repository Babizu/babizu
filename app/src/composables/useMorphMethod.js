/**
 * @file 構詞搜尋的實作：BCDP 或類 pika 剖析器（docs/morph-grammar.md 第 5 節）。
 *
 * 站台設定 `search.morphology.methods` 開放不只一種時，讀者可以在設定選單切換（兩者的結果相同，用來比較速度）。
 * 選擇存在 localStorage（每個瀏覽器各自記住）；存的值不在開放的清單中（站台改了設定）時用站台的預設值。
 */

import { ref } from 'vue'
import site from 'virtual:babizu/site'

/** 儲存鍵以站台代號為前綴，同一個網域放多個辭典網站時才不會互相干擾 */
const STORAGE_KEY = `${site.id}:morphMethod`
/** @type {{methods: string[], default: string}} */
const config = site.search?.morphology ?? { methods: ['bcdp'], default: 'bcdp' }

function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && config.methods.includes(saved)) return saved
  } catch {
    // 無法使用 localStorage（隱私模式等）時用預設值
  }
  return config.default
}

const method = ref(load())

export function useMorphMethod() {
  return {
    /** 目前的實作（'bcdp' 或 'chart'） */
    method,
    /** 站台開放的實作 */
    methods: config.methods,
    /** 讀者可以選擇（開放不只一種） */
    choosable: config.methods.length > 1,
    /** @param {string} value */
    setMethod(value) {
      if (!config.methods.includes(value)) return
      method.value = value
      try {
        localStorage.setItem(STORAGE_KEY, value)
      } catch {
        // 無法儲存時只在這次瀏覽有效
      }
    },
  }
}
