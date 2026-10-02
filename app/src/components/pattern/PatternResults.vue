<script setup>
/**
 * 句型搜尋的結果：三個分頁（網址的 tab）。
 * - 句子：每筆記錄一列，命中的詞高亮，附上每個詞怎麼符合（PatternHitItem）；
 * - 對照：語詞索引（PatternKwic），排序記在網址的 ks；
 * - 頻率：主條件每一格的詞形次數（PatternFrequency）；點一個詞形會篩選句子與對照。
 * 提示（例如 mo- 視為 mu-）列在結果上方。
 */
import { computed, ref, watch } from 'vue'
import StateMessage from '@/components/common/StateMessage.vue'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { t } from '@/i18n.js'
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
/** 分頁：sentences、kwic、frequency */
const tab = defineModel('tab', { type: String, default: 'sentences' })
/** 語詞索引的排序 */
const sort = defineModel('sort', { type: String, default: 'position' })

const PAGE_SIZE = 20
const limit = ref(PAGE_SIZE)
/** 頻率表選取的詞形 @type {import('vue').Ref<{slot: number, form: string} | null>} */
const selected = ref(null)
watch(
  () => props.response,
  () => {
    limit.value = PAGE_SIZE
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
const warnings = computed(() => props.response.warnings.map((/** @type {any} */ w) => patternIssueText(w)))
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
      <li v-for="(w, k) in warnings" :key="k" class="text-muted-foreground border-primary/40 border-l-2 pl-3">{{ w.text }}</li>
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
          <TabsTrigger value="sentences" class="px-3">
            {{ t('句子') }} <span class="text-muted-foreground text-xs tabular-nums">{{ formatCount(hits.length) }}</span>
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

      <TabsContent value="sentences">
        <div class="divide-y">
          <PatternHitItem v-for="hit in hits.slice(0, limit)" :key="hit.doc.id" :hit="hit" />
        </div>
        <div v-if="hits.length > limit" class="mt-4 flex justify-center">
          <Button variant="outline" @click="limit += PAGE_SIZE">{{ t('顯示更多（還有 {count} 筆）', { count: formatCount(hits.length - limit) }) }}</Button>
        </div>
        <p v-else-if="response.totals.hits > response.hits.length" class="text-muted-foreground mt-4 text-center text-xs">
          {{ t('只顯示前 {count} 筆，請加上篩選條件或更精確的查詢。', { count: formatCount(response.hits.length) }) }}
        </p>
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
