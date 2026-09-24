/**
 * @file 資料來源清單（全站共用，只載入一次）。
 */

import { computed, ref, shallowRef } from 'vue'
import { loadSources } from '@/services/data.js'

/** @typedef {Awaited<ReturnType<typeof loadSources>>[number]} SourceInfo */

/** @type {import('vue').ShallowRef<SourceInfo[]>} */
const sources = shallowRef([])
const loaded = ref(false)
/** @type {import('vue').Ref<string | null>} */
const error = ref(null)
/** @type {Promise<void> | null} */
let pending = null

export function useSources() {
  if (!pending) {
    pending = loadSources()
      .then((list) => {
        sources.value = list
        loaded.value = true
      })
      .catch((e) => {
        error.value = e instanceof Error ? e.message : String(e)
        pending = null
      })
  }

  const byId = computed(() => new Map(sources.value.map((s) => [s.id, s])))

  /**
   * 來源的簡稱，找不到時回傳 id。
   * @param {string} id
   */
  const shortTitle = (id) => byId.value.get(id)?.shortTitle ?? id

  /**
   * 這個來源有沒有校對流程。沒有流程的來源不顯示校對狀態
   * （例如手稿轉寫的田調詞表，本來就沒有「校過／沒校過」可言）。
   * @param {string} id
   */
  const tracksReview = (id) => byId.value.get(id)?.reviewTracked === true

  return { sources, byId, loaded, error, shortTitle, tracksReview, ready: () => pending }
}
