/**
 * @file 搜尋索引的載入狀態（全站共用）。
 *
 * 首頁一開啟就在背景載入索引；使用者按下搜尋時通常已經就緒。
 */

import { readonly, ref } from 'vue'
import { getSearchClient } from '@/services/search-client.ts'
import type { SearchClient } from '@/services/search-client.ts'
import type { Ref } from 'vue'

const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const error = ref<string | null>(null)
const stats = ref<{records: number, terms: number} | null>(null)

export function useSearchIndex(): {
  client: SearchClient,
  status: Readonly<Ref<'idle' | 'loading' | 'ready' | 'error'>>,
  error: Readonly<Ref<string | null>>,
  stats: Readonly<Ref<{records: number, terms: number} | null>>,
  load: () => Promise<void>,
} {
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
