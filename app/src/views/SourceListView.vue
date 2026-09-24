<script setup>
/**
 * 來源詞彙清單：列出某個來源中某一類（詞、詞綴、片語、句子）的所有記錄。
 *
 * 從「資料來源」頁的統計數字點進來。清單直接用已載入的搜尋索引產生，
 * 不需要下載該來源的所有分片。
 */
import { ArrowLeftIcon } from '@lucide/vue'
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StateMessage from '@/components/common/StateMessage.vue'
import EntryHitItem from '@/components/search/EntryHitItem.vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSearchIndex } from '@/composables/useSearchIndex.js'
import { useSources } from '@/composables/useSources.js'
import { UNIT_CODES } from '@babizu/schema/constants.js'
import { t } from '@/i18n.js'
import { formatCount, unitLabel } from '@/lib/labels.js'

const route = useRoute()
const router = useRouter()
const { client, load } = useSearchIndex()
const { byId, loaded } = useSources()

const PAGE_SIZE = 100

const sourceId = computed(() => String(route.params.source))
const source = computed(() => byId.value.get(sourceId.value) ?? null)
const unit = computed(() => (typeof route.query.unit === 'string' ? route.query.unit : ''))

/** @type {import('vue').ShallowRef<import('@/services/search-client.js').DocSummary[]>} */
const items = shallowRef([])
const total = ref(0)
const loading = ref(true)
const errorMessage = ref('')

/** 可切換的類別：只列出這個來源真的有的 */
const unitOptions = computed(() => {
  const stats = source.value?.stats ?? {}
  return [
    { value: '', label: t('search.all'), count: stats.records ?? 0 },
    ...UNIT_CODES.filter((u) => (stats[u] ?? 0) > 0).map((u) => ({ value: u, label: unitLabel(u), count: stats[u] })),
  ]
})

/**
 * 請求序號。按「顯示更多」之後馬上切換類別時，舊的那一頁可能比新清單晚回來，
 * 若照樣接在後面，就會把別的類別的詞混進清單。只接受最新一次請求的結果。
 */
let requestSeq = 0

async function fetchPage(offset = 0) {
  const seq = ++requestSeq
  loading.value = true
  errorMessage.value = ''
  try {
    load()
    const result = await client.list({
      filters: { sources: [sourceId.value], units: unit.value ? [unit.value] : [] },
      sort: 'text',
      offset,
      limit: PAGE_SIZE,
    })
    if (seq !== requestSeq) return
    total.value = result.total
    items.value = offset === 0 ? result.items : [...items.value, ...result.items]
  } catch (e) {
    if (seq === requestSeq) errorMessage.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

watch([sourceId, unit], () => fetchPage(0), { immediate: true })

/** 讓 EntryHitItem 可以直接用：清單不是搜尋結果，沒有距離與命中方式 */
const asHit = (/** @type {any} */ doc) => ({
  doc,
  term: doc.text,
  distance: 0,
  matchType: 'fuzzy',
  kind: 'head',
  alignment: null,
})

/** @param {string} value */
function selectUnit(value) {
  router.replace({ name: 'source-list', params: { source: sourceId.value }, query: value ? { unit: value } : {} })
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
    <Button variant="ghost" size="sm" class="text-muted-foreground -ml-2 mb-3" as-child>
      <RouterLink :to="{ name: 'sources' }"><ArrowLeftIcon /> {{ t('nav.sources') }}</RouterLink>
    </Button>

    <StateMessage v-if="!loaded && !source" :title="t('common.loading')" :description="t('sources.loading')" />
    <StateMessage
      v-else-if="loaded && !source"
      :title="t('sources.notFound')"
      :description="t('sources.notFoundHint', { id: sourceId })"
    />

    <template v-else>
      <header class="mb-4">
        <h1 class="font-serif text-2xl font-bold tracking-tight sm:text-3xl">{{ source?.title ?? sourceId }}</h1>
        <p class="text-muted-foreground mt-1 text-sm">
          {{ unit ? t('sourceList.summaryUnit', { count: formatCount(total), unit: unitLabel(unit) }) : t('sourceList.summary', { count: formatCount(total) }) }}
        </p>
      </header>

      <div class="scrollbar-thin -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" :aria-label="t('filter.units')">
        <button
          v-for="opt in unitOptions"
          :key="opt.value"
          type="button"
          role="tab"
          :aria-selected="unit === opt.value"
          class="min-h-9 shrink-0 rounded-sm border px-3 text-sm transition-colors"
          :class="unit === opt.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted'"
          @click="selectUnit(opt.value)"
        >
          {{ opt.label }}
          <span class="ml-1 tabular-nums opacity-70">{{ formatCount(opt.count) }}</span>
        </button>
      </div>

      <StateMessage v-if="errorMessage" tone="error" :title="t('common.loadFailed')" :description="errorMessage" />

      <div v-else-if="loading && items.length === 0" class="space-y-3" aria-busy="true">
        <Skeleton v-for="k in 8" :key="k" class="h-16 w-full" />
      </div>

      <div v-else class="divide-y">
        <EntryHitItem v-for="doc in items" :key="doc.id" :hit="asHit(doc)" />
      </div>

      <div v-if="items.length < total" class="mt-6 flex justify-center">
        <Button variant="outline" :disabled="loading" @click="fetchPage(items.length)">
          {{ loading ? t('common.loading') : t('search.showMore', { count: formatCount(total - items.length) }) }}
        </Button>
      </div>
    </template>
  </div>
</template>
