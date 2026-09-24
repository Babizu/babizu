/**
 * @file 搜尋索引的載入狀態（全站共用）。
 *
 * 首頁一開啟就在背景載入索引；使用者按下搜尋時通常已經就緒。
 */

import { readonly, ref } from 'vue'
import { getSearchClient } from '@/services/search-client.js'

/** @type {import('vue').Ref<'idle' | 'loading' | 'ready' | 'error'>} */
const status = ref('idle')
/** @type {import('vue').Ref<string | null>} */
const error = ref(null)
/** @type {import('vue').Ref<{records: number, terms: number} | null>} */
const stats = ref(null)

/**
 * @returns {{
 *   client: import('@/services/search-client.js').SearchClient,
 *   status: Readonly<import('vue').Ref<'idle' | 'loading' | 'ready' | 'error'>>,
 *   error: Readonly<import('vue').Ref<string | null>>,
 *   stats: Readonly<import('vue').Ref<{records: number, terms: number} | null>>,
 *   load: () => Promise<void>,
 * }}
 */
export function useSearchIndex() {
  const client = getSearchClient()

  async function load() {
    if (status.value === 'ready' || status.value === 'loading') return
    status.value = 'loading'
    error.value = null
    try {
      stats.value = await client.ready()
      status.value = 'ready'
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      status.value = 'error'
    }
  }

  return { client, status: readonly(status), error: readonly(error), stats: readonly(stats), load }
}
