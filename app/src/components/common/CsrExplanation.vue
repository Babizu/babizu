<script setup lang="ts">
/**
 * 對應組檢索（實驗性）的命中說明：按鈕顯示「對應組」與前兩個差異（例如「r→∅、s→ts」），點開列出：
 * - 假設的方言（查詢被當成哪個方言的詞、比對哪個方言的詞）；
 * - 兩邊剝掉的詞綴與剩下的詞幹（每剝一個詞綴另外加分）；
 * - 詞幹的對齊：每個不同的地方是學到的語音對應還是沒見過的差異，各自的成本；兩邊相同的音段合計。
 * 成本是從辭典資料學到的對應機率換算的（越常見越便宜），不是手寫的規則；說明的末尾寫明這是實驗性的比對方式。
 */
import type { CsrExplanation } from '@babizu/search/index.ts'
import { computed, type PropType } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { t } from '@/i18n.ts'
import { csrStepLabel, dialectLabel, formatAffix, formatDistance, formatStep, matchTypeLabel } from '@/lib/labels.ts'

const props = defineProps({
  csr: { type: Object as PropType<CsrExplanation>, required: true },
  query: { type: String, default: '' },
  term: { type: String, default: '' },
})

const steps = computed(() => props.csr.steps ?? [])
/** 不同的地方（學到的對應、沒見過的差異） */
const differences = computed(() => steps.value.filter((s) => s.kind !== 'match'))
const matchCost = computed(() => steps.value.filter((s) => s.kind === 'match').reduce((sum, s) => sum + s.cost, 0))
/** 詞綴的成本：分數扣掉對齊的成本（只在對齊算過時知道） */
const affixCost = computed(() => (props.csr.steps ? props.csr.score - steps.value.reduce((sum, s) => sum + s.cost, 0) : null))
const affixes = computed(() => [...props.csr.queryAffixes, ...props.csr.entryAffixes])
const summary = computed(() => {
  const parts = differences.value.slice(0, 2).map((s) => formatStep(s))
  if (affixes.value.length) parts.unshift(affixes.value.map(formatAffix).join(' '))
  return parts.join(t('、'))
})
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Badge
        as="button"
        type="button"
        size="tag"
        variant="inferred"
        class="max-w-full cursor-pointer"
        :aria-label="t('{label}，分數 {score}，查看說明', { label: matchTypeLabel('csr'), score: formatDistance(csr.score) })"
        @click.stop.prevent
      >
        <span>{{ matchTypeLabel('csr') }}</span>
        <span class="tabular-nums font-normal">{{ formatDistance(csr.score) }}</span>
        <span v-if="summary" class="native-text truncate font-normal">{{ summary }}</span>
      </Badge>
    </PopoverTrigger>
    <PopoverContent class="w-72 text-sm" align="start" @click.stop>
      <div class="flex items-center justify-between gap-2">
        <p class="font-medium">{{ t('對應組檢索的說明') }}</p>
        <Badge size="tag" variant="inferred" class="shrink-0">{{ t('實驗') }}</Badge>
      </div>
      <p class="native-text mt-1.5 text-base leading-tight">{{ csr.queryStem }} ↔ {{ csr.entryStem }}</p>
      <p class="text-muted-foreground mt-1 text-xs">
        {{ t('把查詢當成{query}的詞，比對{entry}的詞。', { query: dialectLabel(csr.queryDialect), entry: dialectLabel(csr.entryDialect) }) }}
      </p>
      <ul v-if="affixes.length" class="mt-2 space-y-1 text-xs">
        <li v-if="csr.queryAffixes.length" class="flex items-baseline gap-2">
          <span class="text-muted-foreground">{{ t('查詢剝掉') }}</span>
          <code v-for="(a, k) in csr.queryAffixes" :key="k" class="bg-muted native-text rounded px-1">{{ formatAffix(a) }}</code>
        </li>
        <li v-if="csr.entryAffixes.length" class="flex items-baseline gap-2">
          <span class="text-muted-foreground">{{ t('這個詞剝掉') }}</span>
          <code v-for="(a, k) in csr.entryAffixes" :key="k" class="bg-muted native-text rounded px-1">{{ formatAffix(a) }}</code>
        </li>
        <li v-if="affixCost !== null" class="text-muted-foreground flex justify-between">
          <span>{{ t('詞綴') }}</span>
          <span class="font-mono tabular-nums">+{{ formatDistance(affixCost) }}</span>
        </li>
      </ul>
      <ul v-if="csr.steps" class="mt-2 space-y-1.5">
        <li v-for="(step, k) in differences" :key="k" class="flex items-baseline justify-between gap-3">
          <span class="flex items-baseline gap-2">
            <code class="bg-muted native-text rounded px-1 font-mono text-xs">{{ formatStep(step) }}</code>
            <span class="text-muted-foreground text-xs">{{ csrStepLabel(step.kind) }}</span>
          </span>
          <span class="text-muted-foreground font-mono text-xs tabular-nums">+{{ formatDistance(step.cost) }}</span>
        </li>
        <li class="text-muted-foreground flex items-baseline justify-between gap-3 text-xs">
          <span>{{ t('其餘相同的音段') }}</span>
          <span class="font-mono tabular-nums">+{{ formatDistance(matchCost) }}</span>
        </li>
      </ul>
      <p class="text-muted-foreground mt-3 text-xs leading-relaxed">
        {{ t('分數 {score}。成本由辭典資料中學到的語音對應換算，越常見越便宜；每剝一個詞綴另外加分。對應組檢索是實驗性的比對方式。', { score: formatDistance(csr.score) }) }}
      </p>
    </PopoverContent>
  </Popover>
</template>
