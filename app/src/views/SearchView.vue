<script setup>
/**
 * 搜尋頁。
 *
 * 狀態都放在網址（?q=…&fz=…&src=…&dia=…&unit=…&tab=…），可分享、可上一頁。
 * 輸入時延遲 300ms 自動搜尋；按 Enter 立即搜尋並記入「最近搜尋」。
 *
 * 結果分三區：
 * - 詞條：詞形、變體、詞根、其他寫法與查詢相符（含跨方言相近拼寫）
 * - 例句：查詢詞出現在其中的例句與語料句
 * - 釋義：中文、英文、臺語釋義相符
 */
import { useDebounceFn } from '@vueuse/core'
import { SearchXIcon } from '@lucide/vue'
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StateMessage from '@/components/common/StateMessage.vue'
import EntryHitItem from '@/components/search/EntryHitItem.vue'
import FilterPanel from '@/components/search/FilterPanel.vue'
import GlossHitItem from '@/components/search/GlossHitItem.vue'
import OccurrenceHitItem from '@/components/search/OccurrenceHitItem.vue'
import SearchBox from '@/components/search/SearchBox.vue'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useRecentSearches } from '@/composables/useRecentSearches.js'
import { useSearchIndex } from '@/composables/useSearchIndex.js'
import { useI18n } from '@/i18n.js'
import { formatCount, formatDistance, site } from '@/lib/labels.js'

const route = useRoute()
const router = useRouter()
const { client, status: indexStatus, error: indexError, load, stats } = useSearchIndex()
const { recent, remember, clear: clearRecent } = useRecentSearches()
const { t, tr } = useI18n()

/** 空狀態的範例查詢（站台設定 examples）：展示跨方言、跨書寫系統與跨語言的查法 */
const EXAMPLES = site.examples

const PAGE_SIZE = 20
/**
 * 「全部」分頁中每區預覽的筆數。
 * 同一個詞常被多個來源收錄（精確命中會佔掉前幾筆），詞條區要留多一點空間，
 * 才看得到跨方言的相近拼寫。
 */
const PREVIEW = { entries: 10, occurrences: 4, glosses: 4 }

// ---- 網址 ↔ 狀態 ----
const list = (/** @type {unknown} */ v) => (typeof v === 'string' && v ? v.split(',') : [])
const query = ref(String(route.query.q ?? ''))
const DEFAULT_FIELDS = ['native', 'gloss']
const filters = computed({
  get: () => ({
    fields: route.query.f === undefined ? DEFAULT_FIELDS : list(route.query.f),
    fuzziness: /** @type {'exact' | 'normal' | 'loose'} */ (route.query.fz ?? 'normal'),
    sources: list(route.query.src),
    dialects: list(route.query.dia),
    units: list(route.query.unit),
  }),
  set: (f) =>
    updateQuery({
      // 只有非預設（兩者都選）時才寫進網址
      f: f.fields.join(',') === DEFAULT_FIELDS.join(',') ? undefined : (f.fields.join(',') ?? ''),
      fz: f.fuzziness === 'normal' ? undefined : f.fuzziness,
      src: f.sources.join(',') || undefined,
      dia: f.dialects.join(',') || undefined,
      unit: f.units.join(',') || undefined,
    }),
})
const tab = computed({
  get: () => String(route.query.tab ?? 'all'),
  set: (t) => updateQuery({ tab: t === 'all' ? undefined : t }),
})
const activeFilterCount = computed(
  () =>
    filters.value.sources.length +
    filters.value.dialects.length +
    filters.value.units.length +
    (filters.value.fields.length === DEFAULT_FIELDS.length ? 0 : 1),
)

/** @param {Record<string, string | undefined>} patch */
function updateQuery(patch, mode = 'replace') {
  const next = { ...route.query, ...patch }
  for (const key of Object.keys(next)) {
    // f=（空字串）代表「兩個範圍都沒選」，要保留在網址上
    if (next[key] === undefined || (next[key] === '' && key !== 'f')) delete next[key]
  }
  return mode === 'push' ? router.push({ query: next }) : router.replace({ query: next })
}

const syncQueryToUrl = useDebounceFn((/** @type {string} */ q) => {
  if (q.trim() !== String(route.query.q ?? '')) updateQuery({ q: q.trim() || undefined, tab: undefined })
}, 300)
watch(query, (q) => syncQueryToUrl(q))
watch(
  () => route.query.q,
  (q) => {
    if (String(q ?? '') !== query.value.trim()) query.value = String(q ?? '')
  },
)

/** @param {string} q */
function onSubmit(q) {
  if (!q) return
  query.value = q
  remember(q)
  updateQuery({ q, tab: undefined }, 'push')
}

// ---- 搜尋 ----
/** @type {import('vue').ShallowRef<import('@/services/search-client.js').SearchResponse | null>} */
const response = shallowRef(null)
const searching = ref(false)
const searchError = ref(/** @type {string | null} */ (null))
const limits = ref({ entries: PAGE_SIZE, occurrences: PAGE_SIZE, glosses: PAGE_SIZE })
let requestSeq = 0

watch(
  () => [route.query.q, route.query.fz, route.query.src, route.query.dia, route.query.unit, route.query.f],
  async () => {
    const q = String(route.query.q ?? '').trim()
    limits.value = { entries: PAGE_SIZE, occurrences: PAGE_SIZE, glosses: PAGE_SIZE }
    if (!q) {
      response.value = null
      return
    }
    const seq = ++requestSeq
    searching.value = true
    searchError.value = null
    try {
      load()
      const f = filters.value
      const result = await client.search(q, {
        fuzziness: f.fuzziness,
        fields: f.fields,
        filters: { sources: f.sources, dialects: f.dialects, units: f.units },
      })
      if (seq === requestSeq) response.value = result
    } catch (e) {
      if (seq === requestSeq) searchError.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (seq === requestSeq) searching.value = false
    }
  },
  { immediate: true },
)

const totals = computed(() => response.value?.totals ?? { entries: 0, occurrences: 0, glosses: 0 })
const totalHits = computed(() => totals.value.entries + totals.value.occurrences + totals.value.glosses)
/** 模糊命中的相近拼寫（距離 > 0） */
const fuzzyTerms = computed(() => (response.value?.terms ?? []).filter((t) => t.distance > 0).slice(0, 8))
const sections = computed(() => {
  const r = response.value
  if (!r) return []
  const fields = filters.value.fields
  return [
    { key: 'entries', label: t('search.section.entries'), items: r.entries, total: r.totals.entries, field: 'native' },
    { key: 'occurrences', label: t('search.section.occurrences'), items: r.occurrences, total: r.totals.occurrences, field: 'native' },
    { key: 'glosses', label: t('search.section.glosses'), items: r.glosses, total: r.totals.glosses, field: 'gloss' },
  ].filter(
    (s) =>
      // 沒選到的搜尋範圍不顯示；有選的範圍即使 0 筆也保留分頁（讓使用者知道有搜）
      fields.includes(s.field) && (s.total > 0 || (r.mode === 'latin' && s.field === 'native')),
  )
})

/** @param {'entries' | 'occurrences' | 'glosses'} key */
function showMore(key) {
  limits.value = { ...limits.value, [key]: limits.value[key] + PAGE_SIZE }
}

const filterSheetOpen = ref(false)
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6">
    <div class="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-14 z-30 -mx-4 px-4 pt-1 pb-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div class="flex items-start gap-2">
        <SearchBox v-model="query" :autofocus="!query" class="min-w-0 flex-1" @submit="onSubmit" />
        <!-- 窄螢幕的搜尋條件按鈕：用文字而非漏斗圖示，意思一看就懂 -->
        <Sheet v-model:open="filterSheetOpen">
          <SheetTrigger as-child>
            <Button variant="outline" class="h-11 shrink-0 gap-1.5 px-3 lg:hidden">
              {{ t('search.filters') }}
              <span
                v-if="activeFilterCount"
                class="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-[10px] tabular-nums"
              >
                {{ activeFilterCount }}
              </span>
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" class="overflow-y-auto">
            <SheetHeader>
              <SheetTitle>{{ t('search.filters') }}</SheetTitle>
              <SheetDescription>{{ t('search.filtersHint') }}</SheetDescription>
            </SheetHeader>
            <div class="px-4 pb-6">
              <FilterPanel v-model="filters" />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>

    <div class="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside class="hidden lg:block">
        <div class="sticky top-36">
          <FilterPanel v-model="filters" />
        </div>
      </aside>

      <section aria-live="polite" class="min-w-0">
        <!-- 索引載入失敗 -->
        <StateMessage
          v-if="indexStatus === 'error' || searchError"
          tone="error"
          :title="t('search.loadFailed')"
          :description="indexError ?? searchError ?? ''"
        >
          <Button variant="outline" @click="load">{{ t('common.retry') }}</Button>
        </StateMessage>

        <!-- 沒有選搜尋範圍 -->
        <StateMessage
          v-else-if="filters.fields.length === 0"
          :title="t('search.noFieldsTitle')"
          :description="t('search.noFieldsHint')"
        >
          <Button variant="outline" @click="filters = { ...filters, fields: ['native', 'gloss'] }">{{ t('search.searchBoth') }}</Button>
        </StateMessage>

        <!--
          尚未輸入：搜尋頁同時是首頁，所以這裡要負責說明「這是什麼、能怎麼查」。
          不做大圖與標語，直接給可以按下去的範例——這是辭典，讀者是來查東西的。
        -->
        <div v-else-if="!route.query.q" class="max-w-2xl py-2">
          <h1 class="font-serif text-2xl font-bold tracking-tight">{{ tr(site.title) }}</h1>
          <p v-if="site.description" class="text-muted-foreground mt-2 leading-relaxed">{{ tr(site.description) }}</p>
          <p class="text-muted-foreground mt-1 text-sm tabular-nums" aria-live="polite">
            <template v-if="indexStatus === 'ready' && stats">
              {{ t('search.loaded', { records: formatCount(stats.records), terms: formatCount(stats.terms) }) }}
            </template>
            <template v-else-if="indexStatus === 'loading'">{{ t('search.loadingIndex') }}</template>
          </p>

          <div v-if="recent.length" class="mt-6">
            <h2 class="text-muted-foreground mb-2 text-xs font-medium tracking-wide">{{ t('search.recent') }}</h2>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <RouterLink
                v-for="q in recent"
                :key="q"
                :to="{ name: 'search', query: { q } }"
                class="native-text text-primary min-h-8 leading-8 hover:underline"
              >
                {{ q }}
              </RouterLink>
              <button type="button" class="text-muted-foreground text-xs hover:underline" @click="clearRecent">{{ t('search.clear') }}</button>
            </div>
          </div>

          <h2 v-if="EXAMPLES.length" class="text-muted-foreground mt-6 mb-2 text-xs font-medium tracking-wide">
            {{ t('search.tryThese') }}
          </h2>
          <ul v-if="EXAMPLES.length" class="divide-border border-border divide-y border-y">
            <li v-for="ex in EXAMPLES" :key="ex.q">
              <button
                type="button"
                class="hover:bg-muted/60 flex min-h-11 w-full items-baseline gap-3 px-1 py-2 text-left transition-colors"
                @click="onSubmit(ex.q)"
              >
                <span class="native-text w-28 shrink-0 font-medium">{{ ex.q }}</span>
                <span class="text-muted-foreground text-sm">{{ tr(ex.note) }}</span>
              </button>
            </li>
          </ul>
        </div>

        <!-- 搜尋中（第一次） -->
        <div v-else-if="!response && (searching || indexStatus !== 'ready')" class="space-y-4" aria-busy="true">
          <p class="text-muted-foreground text-sm">{{ indexStatus === 'ready' ? t('search.searching') : t('search.loadingIndex') }}</p>
          <div v-for="k in 4" :key="k" class="space-y-2 px-4 py-3">
            <Skeleton class="h-6 w-40" />
            <Skeleton class="h-4 w-3/4" />
            <Skeleton class="h-3 w-1/2" />
          </div>
        </div>

        <template v-else-if="response">
          <div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p class="text-muted-foreground text-sm">
              <template v-if="totalHits">
                {{ t('search.resultCountBefore') }}<span class="text-foreground font-medium">{{ response.query }}</span
                >{{ t('search.resultCountAfter', { count: formatCount(totalHits) }) }}
              </template>
              <template v-else>{{ t('search.noResultsFor', { query: response.query }) }}</template>
              <span class="ml-2 text-xs tabular-nums opacity-70">{{ response.stats.elapsedMs }} ms</span>
            </p>
            <p v-if="fuzzyTerms.length" class="text-muted-foreground text-xs">
              {{ t('search.similarSpellings') }}
              <span v-for="(term, k) in fuzzyTerms" :key="term.term">
                <span class="native-text text-foreground">{{ term.term }}</span>
                <span class="tabular-nums">（{{ formatDistance(term.distance) }}）</span>{{ k < fuzzyTerms.length - 1 ? t('common.listSeparator') : '' }}
              </span>
            </p>
          </div>

          <StateMessage
            v-if="totalHits === 0"
            :title="t('search.noResults')"
            :description="filters.fuzziness !== 'loose' ? t('search.noResultsHintLoose') : t('search.noResultsHint')"
          >
            <template #icon><SearchXIcon /></template>
            <Button
              v-if="filters.fuzziness !== 'loose'"
              variant="outline"
              @click="filters = { ...filters, fuzziness: 'loose' }"
            >
              {{ t('search.useLoose') }}
            </Button>
          </StateMessage>

          <Tabs v-else v-model="tab" class="gap-4" :class="searching && 'opacity-60 transition-opacity'">
            <div class="scrollbar-thin -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <TabsList class="h-10">
                <TabsTrigger value="all" class="px-3">{{ t('search.all') }}</TabsTrigger>
                <TabsTrigger v-for="s in sections" :key="s.key" :value="s.key" :disabled="s.total === 0" class="px-3">
                  {{ s.label }}
                  <span class="text-muted-foreground text-xs tabular-nums">{{ formatCount(s.total) }}</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <!-- 全部：每區預覽幾筆 -->
            <TabsContent value="all" class="space-y-8">
              <section v-for="s in sections.filter((x) => x.total > 0)" :key="s.key" :aria-labelledby="`sec-${s.key}`">
                <div class="mb-1 flex items-baseline justify-between border-b pb-2">
                  <h2 :id="`sec-${s.key}`" class="font-semibold">
                    {{ s.label }}
                    <span class="text-muted-foreground ml-1 text-sm font-normal tabular-nums">{{ formatCount(s.total) }}</span>
                  </h2>
                  <button
                    v-if="s.total > PREVIEW[s.key]"
                    type="button"
                    class="text-primary text-sm font-medium hover:underline"
                    @click="tab = s.key"
                  >
                    {{ t('search.seeAll') }}
                  </button>
                </div>
                <div class="divide-y">
                  <template v-for="hit in s.items.slice(0, PREVIEW[s.key])" :key="hit.doc.id">
                    <EntryHitItem v-if="s.key === 'entries'" :hit="hit" :query="response.query" />
                    <OccurrenceHitItem v-else-if="s.key === 'occurrences'" :hit="hit" />
                    <GlossHitItem v-else :hit="hit" :query="response.query" />
                  </template>
                </div>
              </section>
            </TabsContent>

            <!-- 各區完整列表 -->
            <TabsContent v-for="s in sections" :key="s.key" :value="s.key">
              <div class="divide-y">
                <template v-for="hit in s.items.slice(0, limits[s.key])" :key="hit.doc.id">
                  <EntryHitItem v-if="s.key === 'entries'" :hit="hit" :query="response.query" />
                  <OccurrenceHitItem v-else-if="s.key === 'occurrences'" :hit="hit" />
                  <GlossHitItem v-else :hit="hit" :query="response.query" />
                </template>
              </div>
              <div v-if="s.items.length > limits[s.key]" class="mt-4 flex justify-center">
                <Button variant="outline" @click="showMore(s.key)">
                  {{ t('search.showMore', { count: formatCount(s.items.length - limits[s.key]) }) }}
                </Button>
              </div>
              <p v-else-if="s.total > s.items.length" class="text-muted-foreground mt-4 text-center text-xs">
                {{ t('search.truncated', { count: formatCount(s.items.length) }) }}
              </p>
            </TabsContent>
          </Tabs>
        </template>
      </section>
    </div>
  </div>
</template>
