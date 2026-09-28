<script setup>
/**
 * 檢查清單（/checklist）：給校對者的資料檢查。不在主選單，由「資料來源」頁的說明連入。
 *
 * - 例句中沒有詞條的詞：例句、片語裡出現、卻沒有任何辭典來源建立條目的詞，
 *   並列辭典中最接近的詞條，方便判斷它是方言變體、沒被列出的加綴派生，還是真的缺條目。
 * - 完全相同的詞條：辭典來源中詞形完全相同的記錄，放在一起比對。
 *
 * 兩份清單都由搜尋 Worker 以已載入的索引算出（babizu/search 的 Checklist），捲動時一頁一頁載入。
 * 分頁、篩選、排序都記在網址上，可以直接分享或重新整理。
 */
import { ArrowLeftIcon } from '@lucide/vue'
import { computed, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DuplicateGroup from '@/components/checklist/DuplicateGroup.vue'
import TokenRow from '@/components/checklist/TokenRow.vue'
import { DUPLICATE_FILTERS, TOKEN_KINDS } from '@/components/checklist/kinds.js'
import StateMessage from '@/components/common/StateMessage.vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useInfiniteList } from '@/composables/useInfiniteList.js'
import { useSearchIndex } from '@/composables/useSearchIndex.js'
import { useSources } from '@/composables/useSources.js'
import { t } from '@/i18n.js'
import { formatCount } from '@/lib/labels.js'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 20

const route = useRoute()
const router = useRouter()
const { client, load } = useSearchIndex()
const { sources, loaded: sourcesLoaded, error: sourcesError } = useSources()

/** 會建立條目的來源（辭典、詞表）；語料只提供例句 */
const lexicalSources = computed(() => sources.value.filter((s) => s.type !== 'corpus').map((s) => s.id))

// ── 網址上的狀態 ──
const query = (/** @type {string} */ key) => (typeof route.query[key] === 'string' ? /** @type {string} */ (route.query[key]) : '')
const tab = computed(() => (query('tab') === 'duplicates' ? 'duplicates' : 'tokens'))
const kind = computed(() => (TOKEN_KINDS.some((k) => k.value === query('kind')) ? query('kind') : 'all'))
const sort = computed(() => (query('sort') === 'text' ? 'text' : 'count'))
const filter = computed(() => (DUPLICATE_FILTERS.some((f) => f.value === query('filter')) ? query('filter') : 'all'))

/** 改網址上的狀態（預設值不寫進網址） @param {Record<string, string>} patch */
function setQuery(patch) {
  const next = { ...route.query, ...patch }
  for (const [key, value] of Object.entries(patch)) if (!value || value === 'all' || (key === 'tab' && value === 'tokens') || (key === 'sort' && value === 'count')) delete next[key]
  router.replace({ query: next })
}

// ── 資料 ──
/** @type {import('vue').ShallowRef<{entries: number, sentences: number, tokens: number, untreated: number, duplicates: number} | null>} */
const summary = shallowRef(null)
const summaryError = shallowRef('')

const tokens = useInfiniteList(async (offset) => {
  const page = await client.checklist('checklistTokens', { lexicalSources: lexicalSources.value, kind: kind.value, sort: sort.value, offset, limit: PAGE_SIZE })
  return { items: page.items, hasMore: page.hasMore, meta: page }
})
const duplicates = useInfiniteList(async (offset) => {
  const page = await client.checklist('checklistDuplicates', { lexicalSources: lexicalSources.value, filter: filter.value, offset, limit: PAGE_SIZE })
  return { items: page.items, hasMore: offset + page.items.length < page.total, meta: page }
})

watch(
  sourcesLoaded,
  async (ready) => {
    if (!ready) return
    load()
    try {
      summary.value = await client.checklist('checklistSummary', { lexicalSources: lexicalSources.value })
    } catch (e) {
      summaryError.value = e instanceof Error ? e.message : String(e)
    }
  },
  { immediate: true },
)
watch([sourcesLoaded, tab, kind, sort], ([ready]) => ready && tab.value === 'tokens' && tokens.reset(), { immediate: true })
watch([sourcesLoaded, tab, filter], ([ready]) => ready && tab.value === 'duplicates' && duplicates.reset(), { immediate: true })

// ── 顯示 ──
const tokenMeta = computed(() => /** @type {any} */ (tokens.meta.value))
const duplicateMeta = computed(() => /** @type {any} */ (duplicates.meta.value))
const untreatedShare = computed(() => (summary.value?.tokens ? Math.round((summary.value.untreated / summary.value.tokens) * 100) : 0))
/** 類別的數量只算已經比對過的詞：還沒比對完時數字會繼續長 */
const analyzedAll = computed(() => tokenMeta.value && tokenMeta.value.analyzed >= tokenMeta.value.total)

const TABS = computed(() => [
  { value: 'tokens', label: t('例句中沒有詞條的詞'), count: summary.value?.untreated },
  { value: 'duplicates', label: t('完全相同的詞條'), count: summary.value?.duplicates },
])

const CHIP = 'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-sm border px-3 text-sm transition-colors sm:min-h-9 active:translate-y-px motion-reduce:active:translate-y-0'
/** 篩選晶片：與來源詞彙清單相同的外觀（選中的是主色實底） @param {boolean} active */
const chip = (active) => cn(CHIP, active ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted')
/** 排序：次要的設定，選中的只用淡底與深字，不與篩選搶主色 @param {boolean} active */
const sortChip = (active) => cn(CHIP, active ? 'bg-accent text-accent-foreground border-primary/30 font-medium' : 'bg-card text-muted-foreground hover:bg-muted')
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
    <Button variant="ghost" size="sm" class="text-muted-foreground -ml-2 mb-3" as-child>
      <RouterLink :to="{ name: 'sources' }"><ArrowLeftIcon /> {{ t('資料來源') }}</RouterLink>
    </Button>

    <header class="mb-6 max-w-3xl">
      <h1 class="font-serif text-3xl font-bold tracking-tight">{{ t('檢查清單') }}</h1>
      <p class="text-muted-foreground mt-2 leading-relaxed">
        {{ t('給校對者的資料檢查：例句中出現、卻還沒有任何辭典條目的詞，以及不同來源之間詞形完全相同的詞條。清單直接由搜尋索引算出，資料更新後重新整理就是最新的。') }}
      </p>
    </header>

    <StateMessage v-if="sourcesError" tone="error" :title="t('無法載入來源資訊')" :description="sourcesError" />

    <template v-else>
      <!-- 統計：先給整體規模；後兩項就是底下兩份清單 -->
      <section class="border-border mb-8 border-y py-4" aria-labelledby="h-checklist-stats">
        <h2 id="h-checklist-stats" class="sr-only">{{ t('統計') }}</h2>
        <StateMessage v-if="summaryError" tone="error" :title="t('統計載入失敗')" :description="summaryError" />
        <dl v-else class="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5" :aria-busy="!summary">
          <div>
            <dt class="text-muted-foreground text-xs">{{ t('辭典與詞表的條目') }}</dt>
            <dd class="font-serif text-2xl font-bold tabular-nums">
              <template v-if="summary">{{ formatCount(summary.entries) }}</template><Skeleton v-else class="mt-1 h-7 w-20" />
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">{{ t('例句') }}</dt>
            <dd class="font-serif text-2xl font-bold tabular-nums">
              <template v-if="summary">{{ formatCount(summary.sentences) }}</template><Skeleton v-else class="mt-1 h-7 w-20" />
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">{{ t('例句中不同的詞') }}</dt>
            <dd class="font-serif text-2xl font-bold tabular-nums">
              <template v-if="summary">{{ formatCount(summary.tokens) }}</template><Skeleton v-else class="mt-1 h-7 w-20" />
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">{{ t('其中沒有辭典條目') }}</dt>
            <dd class="font-serif text-2xl font-bold tabular-nums">
              <button v-if="summary" type="button" class="group hover:text-primary" @click="setQuery({ tab: 'tokens' })">
                <span class="decoration-primary/40 group-hover:decoration-primary underline decoration-1 underline-offset-4">{{ formatCount(summary.untreated) }}</span><span class="text-muted-foreground ml-1.5 font-sans text-sm font-normal">{{ untreatedShare }}%</span>
              </button>
              <Skeleton v-else class="mt-1 h-7 w-20" />
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">{{ t('詞形完全相同') }}</dt>
            <dd class="font-serif text-2xl font-bold tabular-nums">
              <button v-if="summary" type="button" class="group hover:text-primary" @click="setQuery({ tab: 'duplicates' })">
                <span class="decoration-primary/40 group-hover:decoration-primary underline decoration-1 underline-offset-4">{{ formatCount(summary.duplicates) }}</span><span class="text-muted-foreground ml-1.5 font-sans text-sm font-normal">{{ t('組') }}</span>
              </button>
              <Skeleton v-else class="mt-1 h-7 w-20" />
            </dd>
          </div>
        </dl>
      </section>

      <!-- 兩份清單：分頁用底線標出目前的一份，與頁首選單同一種語彙 -->
      <div class="mb-4 flex gap-6 border-b" role="tablist" :aria-label="t('檢查清單')">
        <button
          v-for="item in TABS"
          :id="`tab-${item.value}`"
          :key="item.value"
          type="button"
          role="tab"
          :aria-selected="tab === item.value"
          :aria-controls="`panel-${item.value}`"
          :class="
            cn(
              '-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 text-sm font-medium transition-colors',
              tab === item.value ? 'border-primary text-foreground' : 'text-muted-foreground hover:text-foreground border-transparent',
            )
          "
          @click="setQuery({ tab: item.value })"
        >
          {{ item.label }}
          <span v-if="item.count !== undefined" class="text-muted-foreground text-xs tabular-nums">{{ formatCount(item.count) }}</span>
        </button>
      </div>

      <!-- ── 例句中沒有詞條的詞 ── -->
      <section v-if="tab === 'tokens'" id="panel-tokens" role="tabpanel" aria-labelledby="tab-tokens">
        <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div class="scrollbar-thin -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" :aria-label="t('依類別篩選')">
            <button type="button" :class="chip(kind === 'all')" :aria-pressed="kind === 'all'" @click="setQuery({ kind: 'all' })">{{ t('全部') }}</button>
            <button
              v-for="k in TOKEN_KINDS"
              :key="k.value"
              type="button"
              :class="chip(kind === k.value)"
              :aria-pressed="kind === k.value"
              :title="t(k.hint)"
              @click="setQuery({ kind: k.value })"
            >
              <span aria-hidden="true" class="font-mono opacity-70">{{ k.glyph }}</span>{{ t(k.label) }}
              <span v-if="tokenMeta" class="text-xs tabular-nums opacity-70">{{ formatCount(tokenMeta.counts[k.value]) }}{{ analyzedAll ? '' : '+' }}</span>
            </button>
          </div>
          <div class="flex gap-2" role="group" :aria-label="t('排序')">
            <button type="button" :class="sortChip(sort === 'count')" :aria-pressed="sort === 'count'" @click="setQuery({ sort: 'count' })">{{ t('依出現次數') }}</button>
            <button type="button" :class="sortChip(sort === 'text')" :aria-pressed="sort === 'text'" @click="setQuery({ sort: 'text' })">{{ t('依字母') }}</button>
          </div>
        </div>
        <p class="text-muted-foreground mt-3 text-xs" aria-live="polite">
          <template v-if="tokenMeta">
            {{ t('已與辭典比對 {analyzed}／{total} 個詞。類別依辭典中最接近的詞條推測，只供參考；點詞條旁的標籤可以看比對與拆解的細節。', { analyzed: formatCount(tokenMeta.analyzed), total: formatCount(tokenMeta.total) }) }}
          </template>
          <template v-else>{{ t('正在與辭典比對…') }}</template>
        </p>

        <!-- 欄位標題（兩欄並列時才需要） -->
        <div class="text-muted-foreground mt-5 hidden gap-x-8 border-b pb-2 text-xs font-medium lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" aria-hidden="true">
          <span>{{ t('例句中的詞') }}</span>
          <span class="pl-8">{{ t('辭典中最接近的詞條') }}</span>
        </div>

        <ol class="divide-y" :aria-busy="tokens.loading.value">
          <TokenRow v-for="item in tokens.items.value" :key="item.term" :item="item" />
        </ol>
        <div v-if="tokens.loading.value" class="divide-y" aria-hidden="true">
          <div v-for="k in tokens.items.value.length ? 2 : 5" :key="k" class="grid gap-x-8 gap-y-3 py-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div class="space-y-2"><Skeleton class="h-6 w-32" /><Skeleton class="h-4 w-full" /><Skeleton class="h-4 w-2/3" /></div>
            <div class="space-y-2 lg:border-l lg:pl-8"><Skeleton class="h-5 w-24" /><Skeleton class="h-5 w-3/4" /><Skeleton class="h-5 w-2/3" /></div>
          </div>
        </div>

        <StateMessage
          v-if="tokens.error.value"
          tone="error"
          class="mt-4"
          :title="t('載入失敗')"
          :description="tokens.error.value"
        >
          <Button variant="outline" @click="tokens.retry()">{{ t('重試') }}</Button>
        </StateMessage>
        <StateMessage
          v-else-if="!tokens.loading.value && !tokens.hasMore.value && !tokens.items.value.length"
          class="mt-4"
          :title="t('這個類別沒有詞')"
          :description="t('換一個類別看看。')"
        />

        <div :ref="(el) => (tokens.sentinel.value = /** @type {HTMLElement | null} */ (el))" class="h-px" aria-hidden="true" />
        <div class="mt-6 flex justify-center">
          <Button v-if="tokens.hasMore.value && !tokens.loading.value && !tokens.error.value" variant="outline" @click="tokens.loadMore()">
            {{ t('載入更多') }}
          </Button>
          <p v-else-if="!tokens.hasMore.value && tokens.items.value.length" class="text-muted-foreground text-xs">
            {{ t('全部 {count} 個詞都列出了', { count: formatCount(tokens.items.value.length) }) }}
          </p>
        </div>
      </section>

      <!-- ── 完全相同的詞條 ── -->
      <section v-else id="panel-duplicates" role="tabpanel" aria-labelledby="tab-duplicates">
        <div class="scrollbar-thin -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" :aria-label="t('篩選')">
          <button
            v-for="f in DUPLICATE_FILTERS"
            :key="f.value"
            type="button"
            :class="chip(filter === f.value)"
            :aria-pressed="filter === f.value"
            :title="f.hint ? t(f.hint) : undefined"
            @click="setQuery({ filter: f.value })"
          >
            {{ t(f.label) }}
            <span v-if="duplicateMeta" class="text-xs tabular-nums opacity-70">{{ formatCount(duplicateMeta.counts[f.value]) }}</span>
          </button>
        </div>
        <p class="text-muted-foreground mt-3 text-xs">
          {{ t('辭典與詞表中詞形（原始寫法）完全相同的記錄，依詞形排序。同一個詞在不同來源、不同義項各有一筆是常見的；「疑似重複登錄」是同一個來源內釋義也相同的。') }}
        </p>

        <ol class="mt-3 divide-y" :aria-busy="duplicates.loading.value">
          <DuplicateGroup v-for="group in duplicates.items.value" :key="group.text" :group="group" />
        </ol>
        <div v-if="duplicates.loading.value" class="divide-y" aria-hidden="true">
          <div v-for="k in duplicates.items.value.length ? 2 : 5" :key="k" class="space-y-2 py-5">
            <Skeleton class="h-6 w-28" /><Skeleton class="h-5 w-full" /><Skeleton class="h-5 w-5/6" />
          </div>
        </div>

        <StateMessage v-if="duplicates.error.value" tone="error" class="mt-4" :title="t('載入失敗')" :description="duplicates.error.value">
          <Button variant="outline" @click="duplicates.retry()">{{ t('重試') }}</Button>
        </StateMessage>
        <StateMessage
          v-else-if="!duplicates.loading.value && !duplicates.hasMore.value && !duplicates.items.value.length"
          class="mt-4"
          :title="t('沒有符合的詞條')"
          :description="t('換一個篩選看看。')"
        />

        <div :ref="(el) => (duplicates.sentinel.value = /** @type {HTMLElement | null} */ (el))" class="h-px" aria-hidden="true" />
        <div class="mt-6 flex justify-center">
          <Button v-if="duplicates.hasMore.value && !duplicates.loading.value && !duplicates.error.value" variant="outline" @click="duplicates.loadMore()">
            {{ t('載入更多') }}
          </Button>
          <p v-else-if="!duplicates.hasMore.value && duplicates.items.value.length" class="text-muted-foreground text-xs">
            {{ t('全部 {count} 組都列出了', { count: formatCount(duplicates.items.value.length) }) }}
          </p>
        </div>
      </section>
    </template>
  </div>
</template>
