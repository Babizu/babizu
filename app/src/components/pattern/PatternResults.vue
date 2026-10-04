<script setup>
/**
 * 句型搜尋的結果：三個分頁（網址的 tab）。
 * - 記錄：依語言單位分成詞條（詞綴與詞）、片語、句子三區（引擎的 PATTERN_GROUPS），每筆記錄一列，
 *   命中的詞高亮，附上每個詞怎麼符合（PatternHitItem）；上方的分區標籤可以只看一區；
 * - 對照：語詞索引（PatternKwic），排序記在網址的 ks；
 * - 頻率：主條件每一格的詞形次數（PatternFrequency）；點一個詞形會篩選句子與對照。
 * 提示（例如 mo- 視為 mu-）列在結果上方；不錨定的改寫（…-pa-…）可以點，其他網址參數（模糊程度、篩選）保留。
 */
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import StateMessage from '@/components/common/StateMessage.vue'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { msg, t } from '@/i18n.js'
import { formatCount } from '@/lib/labels.js'
import { patternIssueText } from '@/lib/pattern.js'
import PatternFrequency from './PatternFrequency.vue'
import PatternHitItem from './PatternHitItem.vue'
import PatternKwic from './PatternKwic.vue'

const props = defineProps({
  /** babizu/pattern 的 PatternResponse */
  response: { type: Object, required: true },
  searching: { type: Boolean, default: false },
})
/** 分頁：records、kwic、frequency */
const tab = defineModel('tab', { type: String, default: 'records' })
/** 語詞索引的排序 */
const sort = defineModel('sort', { type: String, default: 'position' })

const PAGE_SIZE = 20
/** 分區的名稱（引擎的 PATTERN_GROUPS） */
const GROUP_LABELS = { entries: msg('詞條'), phrases: msg('片語'), sentences: msg('句子') }
/** 每一區顯示幾筆 */
const limits = ref({ entries: PAGE_SIZE, phrases: PAGE_SIZE, sentences: PAGE_SIZE })
/** 只看哪一區（all：三區依序列出） */
const section = ref('all')
/** 頻率表選取的詞形 @type {import('vue').Ref<{slot: number, form: string} | null>} */
const selected = ref(null)
watch(
  () => props.response,
  () => {
    limits.value = { entries: PAGE_SIZE, phrases: PAGE_SIZE, sentences: PAGE_SIZE }
    section.value = 'all'
    selected.value = null
  },
)

/** 一個命中區間在某一格比到的詞形 @param {any} m @param {number} slot */
const formAt = (m, slot) =>
  m.cells
    .filter((/** @type {any} */ c) => c.slot === slot)
    .map((/** @type {any} */ c) => c.key)
    .join(' ')

/** 依頻率表的選取過濾：只留下那一格是那個詞形的命中區間 */
const hits = computed(() => {
  const all = /** @type {any[]} */ (props.response.hits)
  const sel = selected.value
  if (!sel) return all
  return all
    .map((h) => ({ ...h, matches: h.matches.filter((/** @type {any} */ m) => m.cond !== 0 || formAt(m, sel.slot) === sel.form) }))
    .filter((h) => h.matches.some((/** @type {any} */ m) => m.cond === 0))
})
/**
 * 有命中的分區：名稱、筆數（選了頻率表的詞形時是篩選後的筆數）與這一區的記錄。
 * 舊版的回應沒有分區時，全部當成一區（句子）。
 */
const groups = computed(() => {
  const list = /** @type {Array<{key: keyof typeof GROUP_LABELS, total: number}>} */ (props.response.groups ?? [{ key: 'sentences', total: props.response.totals.hits }])
  return list
    .map((g) => {
      const items = hits.value.filter((h) => (h.group ?? 'sentences') === g.key)
      return { key: g.key, label: t(GROUP_LABELS[g.key]), total: selected.value ? items.length : g.total, items }
    })
    .filter((g) => g.items.length > 0)
})
/** 目前列出的分區 */
const shown = computed(() => (section.value === 'all' ? groups.value : groups.value.filter((g) => g.key === section.value)))
/** 記錄分頁上的筆數 */
const recordCount = computed(() => groups.value.reduce((sum, g) => sum + g.total, 0))
/** @param {keyof typeof GROUP_LABELS} key */
const showMore = (key) => {
  limits.value = { ...limits.value, [key]: limits.value[key] + PAGE_SIZE }
}
const warnings = computed(() => props.response.warnings.map((/** @type {any} */ w) => patternIssueText(w)))
const route = useRoute()
/** 提示的改寫：同一頁換掉查詢（以句型搜尋），分頁回到句子 @param {string} q */
const rewrite = (q) => ({ name: 'search', query: { ...route.query, q, m: 'pattern', tab: undefined } })
</script>

<template>
  <div :class="searching && 'opacity-60 transition-opacity'">
    <p class="text-muted-foreground mb-3 text-sm">
      <template v-if="response.totals.hits">
        {{ t('共 {hits} 筆記錄、{matches} 處命中', { hits: formatCount(response.totals.hits), matches: formatCount(response.totals.matches) }) }}
      </template>
      <template v-else>{{ t('沒有符合這個句型的記錄') }}</template>
      <span class="ml-2 text-xs tabular-nums opacity-70">{{ response.stats.elapsedMs }} ms</span>
    </p>
    <ul v-if="warnings.length" class="mb-4 space-y-1 text-sm">
      <li v-for="(w, k) in warnings" :key="k" class="text-muted-foreground border-primary/40 border-l-2 pl-3">
        {{ w.text }}
        <RouterLink v-if="w.query" :to="rewrite(w.query)" class="text-primary ml-1 inline-flex min-h-6 items-center gap-1 underline-offset-2 hover:underline">
          {{ t('改查') }} <code class="native-text">{{ w.query }}</code>
        </RouterLink>
      </li>
    </ul>
    <p v-if="response.stats.truncated" class="text-muted-foreground mb-4 text-xs">
      {{ t('命中太多，只列出一部分；請把句型寫得更明確，或加上篩選條件。') }}
    </p>

    <StateMessage
      v-if="response.totals.hits === 0"
      :title="t('找不到符合的記錄')"
      :description="t('試試放寬句型（例如把詞換成 _ 或 @詞）、把模糊程度調成「寬鬆」，或減少篩選條件。')"
    />

    <Tabs v-else v-model="tab" class="gap-4">
      <div class="scrollbar-thin -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <TabsList class="h-10">
          <TabsTrigger value="records" class="px-3">
            {{ t('記錄') }} <span class="text-muted-foreground text-xs tabular-nums">{{ formatCount(recordCount) }}</span>
          </TabsTrigger>
          <TabsTrigger value="kwic" class="px-3">{{ t('對照') }}</TabsTrigger>
          <TabsTrigger value="frequency" class="px-3">{{ t('頻率') }}</TabsTrigger>
        </TabsList>
      </div>

      <!-- 頻率表的篩選：可移除的小標籤，在每個分頁都看得到 -->
      <div v-if="selected" class="flex flex-wrap items-center gap-2 text-sm">
        <span class="text-muted-foreground">{{ t('只看第 {slot} 格是', { slot: selected.slot + 1 }) }}</span>
        <button
          type="button"
          class="bg-accent text-accent-foreground hover:bg-accent/70 inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 transition-colors"
          :aria-label="t('取消篩選')"
          @click="selected = null"
        >
          <span class="native-text">{{ selected.form || t('（沒有詞）') }}</span>
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <TabsContent value="records" class="space-y-8">
        <!-- 分區標籤：只看一區（兩區以上有命中時才顯示） -->
        <div v-if="groups.length > 1" class="flex flex-wrap gap-2" role="group" :aria-label="t('只看一種記錄')">
          <button
            v-for="g in [{ key: 'all', label: t('全部'), total: recordCount }, ...groups]"
            :key="g.key"
            type="button"
            :aria-pressed="section === g.key"
            class="inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors"
            :class="section === g.key ? 'bg-accent text-accent-foreground border-transparent' : 'hover:bg-muted/60 text-muted-foreground'"
            @click="section = g.key"
          >
            {{ g.label }} <span class="text-xs tabular-nums opacity-70">{{ formatCount(g.total) }}</span>
          </button>
        </div>
        <section v-for="g in shown" :key="g.key" :aria-labelledby="`pattern-sec-${g.key}`">
          <h2 :id="`pattern-sec-${g.key}`" class="mb-1 border-b pb-2 font-semibold">
            {{ g.label }}
            <span class="text-muted-foreground ml-1 text-sm font-normal tabular-nums">{{ formatCount(g.total) }}</span>
          </h2>
          <div class="divide-y">
            <PatternHitItem v-for="hit in g.items.slice(0, limits[g.key])" :key="hit.doc.id" :hit="hit" />
          </div>
          <div v-if="g.items.length > limits[g.key]" class="mt-4 flex justify-center">
            <Button variant="outline" @click="showMore(g.key)">{{ t('顯示更多（還有 {count} 筆）', { count: formatCount(g.items.length - limits[g.key]) }) }}</Button>
          </div>
          <p v-else-if="g.total > g.items.length" class="text-muted-foreground mt-4 text-center text-xs">
            {{ t('只顯示前 {count} 筆，請加上篩選條件或更精確的查詢。', { count: formatCount(g.items.length) }) }}
          </p>
        </section>
      </TabsContent>
      <TabsContent value="kwic">
        <PatternKwic v-model:sort="sort" :hits="hits" />
      </TabsContent>
      <TabsContent value="frequency">
        <PatternFrequency v-model="selected" :frequency="response.frequency" :slots="response.slots" />
      </TabsContent>
    </Tabs>
  </div>
</template>
