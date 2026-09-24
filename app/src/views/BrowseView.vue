<script setup>
/**
 * 來源瀏覽：依來源的分片（辭典的頁、分類的章、語料的場次）逐一瀏覽。
 * 《巴宰語詞典》可在桌面並排顯示原書掃描頁，方便對照。
 */
import { ChevronLeftIcon, ChevronRightIcon, FileImageIcon } from '@lucide/vue'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StateMessage from '@/components/common/StateMessage.vue'
import GroupRecords from '@/components/record/GroupRecords.vue'
import ScanViewer from '@/components/record/ScanViewer.vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSources } from '@/composables/useSources.js'
import { t } from '@/i18n.js'
import { formatCount, shardUnitLabel } from '@/lib/labels.js'
import { dataUrl, loadShard } from '@/services/data.js'

const route = useRoute()
const router = useRouter()
const { byId, loaded, error: sourcesError } = useSources()

const source = computed(() => byId.value.get(String(route.params.source)) ?? null)
const shards = computed(() => source.value?.shards ?? [])
const shardKey = computed(() => String(route.params.shard || shards.value[0]?.key || ''))
const shardIndex = computed(() => shards.value.findIndex((s) => s.key === shardKey.value))

/** @type {import('vue').ShallowRef<import('@babizu/schema/types.js').CorpusShard | null>} */
const shard = shallowRef(null)
const loading = ref(false)
const loadError = ref('')
const scanOpen = ref(false)
const showScan = ref(true)

watch(
  [() => source.value?.id, shardKey],
  async ([sourceId, key]) => {
    if (!sourceId || !key) return
    loading.value = true
    loadError.value = ''
    // 快速翻頁時，舊請求晚回來不能動到新頁面的狀態（載入中、錯誤訊息都一樣）
    const isCurrent = () => sourceId === source.value?.id && key === shardKey.value
    try {
      const data = await loadShard(sourceId, key)
      if (!isCurrent()) return
      shard.value = data
      await nextTick()
      scrollToHash()
    } catch (e) {
      if (isCurrent()) loadError.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (isCurrent()) loading.value = false
    }
  },
  { immediate: true },
)

/** 從詞條頁「瀏覽此頁」進來時，捲到該筆記錄 */
function scrollToHash() {
  const id = decodeURIComponent(route.hash.slice(1))
  if (!id) return
  document.getElementById(id)?.scrollIntoView({ block: 'center' })
}

/** 每個群組的記錄 */
const groups = computed(() => {
  const data = shard.value
  if (!data) return []
  /** @type {Map<string, any[]>} */
  const byGroup = new Map()
  const loose = []
  for (const r of data.records) {
    if (r.group) {
      const list = byGroup.get(r.group.id) ?? []
      list.push(r)
      byGroup.set(r.group.id, list)
    } else loose.push(r)
  }
  const out = data.groups.map((g) => ({ group: g, records: byGroup.get(g.id) ?? [] }))
  if (loose.length) out.push({ group: { id: 'loose', type: 'list', title: t('browse.other'), subtitle: null }, records: loose })
  return out
})

/** 分頁模式的掃描圖：取分片中第一筆有掃描圖的記錄 */
const scan = computed(() => shard.value?.records.find((r) => r.citation.scan)?.citation.scan ?? null)
const activeId = computed(() => decodeURIComponent(route.hash.slice(1)))

/** @param {number} offset */
function go(offset) {
  const next = shards.value[shardIndex.value + offset]
  if (next) router.push({ name: 'browse', params: { source: source.value?.id, shard: next.key } })
}

/** @param {Event} event */
function onSelect(event) {
  const key = /** @type {HTMLSelectElement} */ (event.target).value
  router.push({ name: 'browse', params: { source: source.value?.id, shard: key } })
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
    <StateMessage v-if="sourcesError" tone="error" :title="t('sources.loadFailed')" :description="sourcesError" />
    <div v-else-if="!loaded" class="space-y-3">
      <Skeleton class="h-8 w-64" />
      <Skeleton class="h-96 w-full" />
    </div>
    <StateMessage v-else-if="!source" :title="t('sources.notFound')" :description="t('sources.notFoundHint', { id: route.params.source })">
      <Button as-child variant="outline"><RouterLink :to="{ name: 'sources' }">{{ t('sources.all') }}</RouterLink></Button>
    </StateMessage>

    <template v-else>
      <header class="mb-4">
        <RouterLink :to="{ name: 'sources' }" class="text-muted-foreground text-sm hover:underline">{{ t('nav.sources') }}</RouterLink>
        <h1 class="mt-1 font-serif text-2xl font-bold tracking-tight sm:text-3xl">{{ source.title }}</h1>
      </header>

      <!-- 分片導覽：上一個／選單／下一個（行動裝置固定在頂部方便連續翻頁） -->
      <nav
        class="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-14 z-30 -mx-4 mb-4 flex items-center gap-2 border-b px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6"
        :aria-label="t('browse.select', { unit: shardUnitLabel(source) })"
      >
        <Button variant="outline" size="icon" :disabled="shardIndex <= 0" :aria-label="t('browse.previous', { unit: shardUnitLabel(source) })" @click="go(-1)">
          <ChevronLeftIcon />
        </Button>
        <select
          class="border-input bg-card focus-visible:ring-ring/50 h-9 min-w-0 flex-1 rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] sm:max-w-xs"
          :value="shardKey"
          :aria-label="shardUnitLabel(source)"
          @change="onSelect"
        >
          <option v-for="s in shards" :key="s.key" :value="s.key">{{ t('browse.option', { label: s.label, count: formatCount(s.records) }) }}</option>
        </select>
        <Button variant="outline" size="icon" :disabled="shardIndex >= shards.length - 1" :aria-label="t('browse.next', { unit: shardUnitLabel(source) })" @click="go(1)">
          <ChevronRightIcon />
        </Button>
        <span class="text-muted-foreground ml-auto hidden text-xs tabular-nums sm:inline">
          {{ shardIndex + 1 }} / {{ shards.length }}
        </span>
        <Button v-if="scan" variant="ghost" size="sm" class="hidden lg:inline-flex" @click="showScan = !showScan">
          <FileImageIcon /> {{ showScan ? t('browse.hideScan') : t('browse.showScan') }}
        </Button>
        <Button v-if="scan" variant="outline" size="icon" class="lg:hidden" :aria-label="t('citation.viewScan')" @click="scanOpen = true">
          <FileImageIcon />
        </Button>
      </nav>

      <StateMessage v-if="loadError" tone="error" :title="t('common.loadFailed')" :description="loadError" />

      <div
        v-else
        class="grid gap-6"
        :class="scan && showScan ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''"
        :aria-busy="loading"
      >
        <div class="min-w-0 space-y-6" :class="loading && 'opacity-60'">
          <section v-for="{ group, records } in groups" :key="group.id" :aria-label="group.title">
            <div v-if="group.type !== 'entry'" class="mb-1 flex items-baseline justify-between gap-3 border-b pb-2">
              <h2 class="font-semibold">{{ group.title }}</h2>
              <span v-if="group.subtitle" class="text-muted-foreground truncate text-xs">{{ group.subtitle }}</span>
            </div>
            <GroupRecords :group="group" :records="records" :active-id="activeId" />
          </section>
          <p v-if="!loading && groups.length === 0" class="text-muted-foreground text-sm">{{ t('browse.empty', { unit: shardUnitLabel(source) }) }}</p>
        </div>

        <div v-if="scan && showScan" class="hidden lg:block">
          <div class="sticky top-32">
            <img
              :src="dataUrl(scan)"
              :alt="t('browse.scanAlt', { label: shard?.label ?? '' })"
              class="w-full rounded-md border"
              loading="lazy"
            />
            <Button variant="link" size="sm" class="px-0" @click="scanOpen = true">{{ t('browse.zoom') }}</Button>
          </div>
        </div>
      </div>

      <ScanViewer v-if="scan" v-model:open="scanOpen" :scan="scan" :title="`${source.shortTitle} ${shard?.label ?? ''}`" />
    </template>
  </div>
</template>
