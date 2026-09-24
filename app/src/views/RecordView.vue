<script setup>
/**
 * 詞條頁：一筆記錄的完整資訊。
 *
 * 版面（桌面兩欄、行動裝置單欄）：
 * - 主欄：詞形與標籤、義項、構詞與變體、逐詞對譯、相關條目、同群組脈絡、跨來源相近詞
 * - 側欄：出處（溯源卡）
 *
 * 載入流程：搜尋 Worker 以 id 查出所在分片 → 讀取分片 JSON → 取出記錄與同群組記錄。
 */
import { ArrowLeftIcon, FileQuestionIcon } from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AudioButton from '@/components/common/AudioButton.vue'
import DialectBadge from '@/components/common/DialectBadge.vue'
import MetaTag from '@/components/common/MetaTag.vue'
import StateMessage from '@/components/common/StateMessage.vue'
import CitationCard from '@/components/record/CitationCard.vue'
import GroupRecords from '@/components/record/GroupRecords.vue'
import InterlinearGloss from '@/components/record/InterlinearGloss.vue'
import NeighborList from '@/components/record/NeighborList.vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSearchIndex } from '@/composables/useSearchIndex.js'
import { useSources } from '@/composables/useSources.js'
import { pageTitle } from '@/composables/usePageTitle.js'
import { t } from '@/i18n.js'
import { recordRoute, roleLabel, unitLabel, writingSystemLabel } from '@/lib/labels.js'
import { loadShard } from '@/services/data.js'

const route = useRoute()
const router = useRouter()
const { client, load } = useSearchIndex()
const { byId: sourcesById } = useSources()

const id = computed(() => `${route.params.source}:${route.params.localId}`)
/** 桌面把出處卡放側欄，行動裝置放在內容中間（只渲染一份） */
const isDesktop = useMediaQuery('(min-width: 1024px)')

/** @type {import('vue').ShallowRef<any>} */
const record = shallowRef(null)
/** @type {import('vue').ShallowRef<any>} */
const group = shallowRef(null)
/** @type {import('vue').ShallowRef<any[]>} */
const groupRecords = shallowRef([])
/** @type {import('vue').ShallowRef<{key: string, label: string} | null>} */
const shard = shallowRef(null)
/** @type {import('vue').ShallowRef<any[] | null>} */
const neighbors = shallowRef(null)
/** @type {import('vue').ShallowRef<Array<{id: string, text: string, type: string}>>} */
const related = shallowRef([])
const status = ref(/** @type {'loading' | 'ready' | 'not-found' | 'error'} */ ('loading'))
const errorMessage = ref('')

watch(
  id,
  async (currentId) => {
    status.value = 'loading'
    neighbors.value = null
    related.value = []
    try {
      load()
      const doc = await client.docById(currentId)
      if (currentId !== id.value) return
      if (!doc) {
        status.value = 'not-found'
        return
      }
      const data = await loadShard(doc.source, doc.shard)
      if (currentId !== id.value) return
      const found = data.records.find((r) => r.id === currentId)
      if (!found) {
        status.value = 'not-found'
        return
      }
      record.value = found
      shard.value = { key: data.shard, label: data.label }
      group.value = found.group ? (data.groups.find((g) => g.id === found.group.id) ?? null) : null
      groupRecords.value = found.group ? data.records.filter((r) => r.group?.id === found.group.id) : [found]
      status.value = 'ready'
      // 分頁標題用詞形，分享連結、書籤與瀏覽紀錄才認得出是哪一筆
      pageTitle.value = found.text

      // 次要資訊：非同步補上，不阻塞主內容。
      // 失敗時要落到「空」而不是一直停在 null，否則相近詞區塊會永遠顯示載入骨架。
      client
        .neighbors(currentId)
        .catch(() => [])
        .then((hits) => {
          if (currentId === id.value) neighbors.value = hits
        })
      Promise.all(
        found.related.map(async (/** @type {any} */ link) => {
          const target = await client.docById(link.target).catch(() => null)
          return { id: link.target, text: target?.text ?? link.target, type: link.type }
        }),
      ).then((list) => {
        if (currentId === id.value) related.value = list
      })
    } catch (e) {
      // 使用者已經切到別筆就不要用舊請求的錯誤蓋掉新頁面
      if (currentId !== id.value) return
      errorMessage.value = e instanceof Error ? e.message : String(e)
      status.value = 'error'
    }
  },
  { immediate: true },
)

const source = computed(() => (record.value ? (sourcesById.value.get(record.value.source) ?? null) : null))
const audio = computed(() => record.value?.media.find((/** @type {any} */ m) => m.type === 'audio' && m.available))
const morphology = computed(() => record.value?.morphology)
const hasMorphology = computed(
  () =>
    !!morphology.value &&
    (morphology.value.derivedFrom.length > 0 || morphology.value.segmentation || morphology.value.gloss),
)
const groupHeading = computed(() => {
  if (!group.value) return ''
  if (group.value.type === 'entry') return t('record.entryGroup', { title: group.value.title })
  if (group.value.type === 'recording') return t('record.recordingGroup', { title: group.value.title })
  return group.value.title
})
const showGroup = computed(() => groupRecords.value.length > 1)

/** 回上一頁；若是直接開啟詞條頁（沒有上一頁）則回搜尋 */
function goBack() {
  if (window.history.state?.back) router.back()
  else router.push({ name: 'search' })
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-8">
    <Button variant="ghost" size="sm" class="text-muted-foreground -ml-2 mb-3" @click="goBack">
      <ArrowLeftIcon /> {{ t('common.back') }}
    </Button>

    <div v-if="status === 'loading'" class="space-y-4" aria-busy="true">
      <Skeleton class="h-10 w-56" />
      <Skeleton class="h-5 w-80 max-w-full" />
      <Skeleton class="h-40 w-full" />
    </div>

    <StateMessage
      v-else-if="status === 'not-found'"
      :title="t('record.notFound')"
      :description="t('record.notFoundHint', { id })"
    >
      <template #icon><FileQuestionIcon /></template>
      <Button as-child variant="outline"><RouterLink :to="{ name: 'search' }">{{ t('record.goSearch') }}</RouterLink></Button>
    </StateMessage>

    <StateMessage v-else-if="status === 'error'" tone="error" :title="t('common.loadFailed')" :description="errorMessage" />

    <div v-else-if="record" class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <article class="min-w-0 space-y-8">
        <!-- 標題 -->
        <header class="space-y-3">
          <div class="flex items-start gap-3">
            <h1
              class="native-text min-w-0 flex-1 font-semibold tracking-tight"
              :class="record.unit === 'sentence' ? 'text-2xl leading-snug sm:text-3xl' : 'text-4xl sm:text-5xl'"
            >
              {{ record.text }}
            </h1>
            <AudioButton
              v-if="audio"
              size="icon-lg"
              class="mt-1 shrink-0"
              :play-key="record.id"
              :src="audio.src"
              :start="audio.start"
              :end="audio.end"
              :label="record.text"
            />
          </div>
          <p v-if="record.altTexts.length" class="text-muted-foreground text-sm">
            <span v-for="alt in record.altTexts" :key="alt.system + alt.text" class="mr-4 inline-block">
              {{ writingSystemLabel(alt.system) }}{{ t('common.colon') }}<span class="native-text text-foreground">{{ alt.text }}</span>
            </span>
          </p>
          <div class="flex flex-wrap items-center gap-1.5">
            <DialectBadge v-for="d in record.dialects" :key="d" :dialect="d" />
            <MetaTag v-if="record.dialectRaw" :title="t('record.dialectRawHint')">{{ t('record.dialectRaw', { raw: record.dialectRaw }) }}</MetaTag>
            <MetaTag>{{ unitLabel(record.unit) }}</MetaTag>
            <MetaTag v-if="record.group && record.group.role !== 'item'">{{ roleLabel(record.group.role) }}</MetaTag>
            <MetaTag v-if="record.pos">{{ t('record.pos', { pos: record.pos }) }}</MetaTag>
            <MetaTag v-if="record.domain">
              {{ t('record.domain', { domain: record.domain.label ?? record.domain.code }) }}
            </MetaTag>
          </div>
        </header>

        <!-- 義項 -->
        <section v-if="record.senses.length" aria-labelledby="h-senses">
          <h2 id="h-senses" class="text-muted-foreground mb-2 text-sm font-medium">{{ t('record.senses') }}</h2>
          <ol class="space-y-3">
            <li v-for="(sense, k) in record.senses" :key="k" class="flex gap-3">
              <span v-if="record.senses.length > 1" class="text-muted-foreground w-5 shrink-0 pt-0.5 text-right text-sm tabular-nums">
                {{ k + 1 }}.
              </span>
              <div class="min-w-0 space-y-0.5">
                <p v-if="sense.zh" class="gloss-zh text-lg">{{ sense.zh }}</p>
                <p v-if="sense.en" class="text-muted-foreground">{{ sense.en }}</p>
                <p v-if="sense.nan" class="text-muted-foreground text-sm">{{ t('record.nan') }}{{ sense.nan }}</p>
                <p v-if="sense.note" class="text-muted-foreground text-sm">{{ sense.note }}</p>
              </div>
            </li>
          </ol>
        </section>

        <!-- 逐詞對譯 -->
        <section v-if="record.interlinear.length" aria-labelledby="h-igt" class="bg-muted/40 rounded-xl border p-4">
          <h2 id="h-igt" class="text-muted-foreground mb-3 text-sm font-medium">{{ t('record.interlinear') }}</h2>
          <InterlinearGloss :pairs="record.interlinear" />
        </section>

        <!-- 構詞、變體、相關條目 -->
        <section
          v-if="hasMorphology || record.variants.length || related.length || record.notes.length"
          aria-labelledby="h-morph"
        >
          <h2 id="h-morph" class="sr-only">{{ t('record.morphology') }}</h2>
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
            <template v-if="morphology?.derivedFrom.length">
              <dt class="text-muted-foreground">{{ t('record.derivedFrom') }}</dt>
              <dd class="flex flex-wrap gap-x-3">
                <RouterLink
                  v-for="d in morphology.derivedFrom"
                  :key="d.text"
                  :to="{ name: 'search', query: { q: d.text } }"
                  class="native-text text-primary hover:underline"
                >
                  {{ d.relation === '+' ? '+ ' : '' }}{{ d.text }}
                </RouterLink>
              </dd>
            </template>
            <template v-if="morphology?.segmentation">
              <dt class="text-muted-foreground">{{ t('record.segmentation') }}</dt>
              <dd class="native-text">{{ morphology.segmentation }}</dd>
            </template>
            <template v-if="morphology?.gloss">
              <dt class="text-muted-foreground">{{ t('record.morphemeGloss') }}</dt>
              <dd>{{ morphology.gloss }}</dd>
            </template>
            <template v-if="record.variants.length">
              <dt class="text-muted-foreground">{{ t('record.variants') }}</dt>
              <dd class="flex flex-wrap gap-x-4 gap-y-1">
                <span v-for="v in record.variants" :key="v.relation + v.text">
                  <span class="text-muted-foreground mr-1">{{ v.relation === '=' ? '＝' : '～' }}</span>
                  <RouterLink :to="{ name: 'search', query: { q: v.text } }" class="native-text text-primary hover:underline">
                    {{ v.text }}
                  </RouterLink>
                  <span v-if="v.dialectRaw" class="text-muted-foreground ml-1 text-xs">{{ v.dialectRaw }}</span>
                  <span v-if="v.attribution" class="text-muted-foreground ml-1 text-xs">（{{ v.attribution }}）</span>
                </span>
              </dd>
            </template>
            <template v-if="related.length">
              <dt class="text-muted-foreground">{{ t('record.related') }}</dt>
              <dd class="flex flex-wrap gap-x-4">
                <RouterLink v-for="r in related" :key="r.id" :to="recordRoute(r.id)" class="native-text text-primary hover:underline">
                  {{ r.text }}
                </RouterLink>
              </dd>
            </template>
            <template v-if="record.notes.length">
              <dt class="text-muted-foreground">{{ t('record.notes') }}</dt>
              <dd class="space-y-1">
                <p v-for="(note, k) in record.notes" :key="k">{{ note }}</p>
              </dd>
            </template>
          </dl>
        </section>

        <!-- 行動裝置：出處放在內容中間，靠近詞條本身 -->
        <CitationCard v-if="shard && !isDesktop" :record="record" :source="source" :shard="shard" />

        <!-- 同群組脈絡 -->
        <section v-if="showGroup && group" aria-labelledby="h-group">
          <div class="mb-2 flex items-baseline justify-between gap-3 border-b pb-2">
            <h2 id="h-group" class="font-semibold">{{ groupHeading }}</h2>
            <span v-if="group.subtitle" class="text-muted-foreground truncate text-xs">{{ group.subtitle }}</span>
          </div>
          <GroupRecords
            :group="group"
            :records="groupRecords"
            :active-id="record.id"
            :window="group.type === 'entry' || group.type === 'recording' ? 0 : 5"
          />
        </section>

        <!-- 跨來源相近詞 -->
        <section v-if="record.unit !== 'sentence'" aria-labelledby="h-neighbors">
          <div class="mb-1 border-b pb-2">
            <h2 id="h-neighbors" class="font-semibold">{{ t('record.neighbors') }}</h2>
            <p class="text-muted-foreground mt-0.5 text-xs">{{ t('record.neighborsHint') }}</p>
          </div>
          <div v-if="neighbors === null" class="space-y-2 py-2">
            <Skeleton v-for="k in 3" :key="k" class="h-10 w-full" />
          </div>
          <p v-else-if="neighbors.length === 0" class="text-muted-foreground py-4 text-sm">{{ t('record.noNeighbors') }}</p>
          <NeighborList v-else :hits="neighbors" :query="record.text" />
        </section>
      </article>

      <aside v-if="isDesktop">
        <div class="sticky top-20 space-y-4">
          <CitationCard v-if="shard" :record="record" :source="source" :shard="shard" />
        </div>
      </aside>
    </div>
  </div>
</template>
