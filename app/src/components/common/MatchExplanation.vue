<script setup>
/**
 * 模糊命中的說明：距離＋每個非相同字元的對齊步驟（例如「l→n 詞尾」）。
 * 點擊可展開完整說明，並連到演算法實驗室看動態規劃表。
 */
import { SparklesIcon } from '@lucide/vue'
import { computed } from 'vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { t } from '@/i18n.js'
import { categoryLabel, COSTS, formatDistance, formatStep, opLabel } from '@/lib/labels.js'

const props = defineProps({
  distance: { type: Number, required: true },
  /** search-core 的 AlignmentNote[] */
  alignment: { type: Array, default: null },
  query: { type: String, default: '' },
  term: { type: String, default: '' },
})

const steps = computed(() => /** @type {Array<{op: string, source: string, target: string, cost: number, category: string | null}>} */ (props.alignment ?? []))
/** 摘要只列前兩步 */
const summary = computed(() =>
  steps.value
    .slice(0, 2)
    .map((s) => (s.category ? `${formatStep(s)} ${categoryLabel(s.category)}` : formatStep(s)))
    .join(t('common.listSeparator')),
)
const allRules = computed(() => steps.value.length > 0 && steps.value.every((s) => s.op === 'rule'))
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <button
        type="button"
        class="inline-flex h-5 max-w-full items-center gap-1 rounded px-1.5 text-[11px] leading-none whitespace-nowrap transition-colors"
        :class="
          allRules
            ? 'bg-accent text-accent-foreground hover:bg-accent/80'
            : 'text-muted-foreground border hover:bg-muted'
        "
        :aria-label="t('match.explainButton', { distance: formatDistance(distance) })"
        @click.stop.prevent
      >
        <SparklesIcon v-if="allRules" class="size-3" />
        <span>≈ {{ formatDistance(distance) }}</span>
        <span v-if="summary" class="truncate">{{ summary }}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-72 text-sm" align="start" @click.stop>
      <p class="font-medium">{{ t('match.whyTitle') }}</p>
      <p class="text-muted-foreground mt-1 text-xs">
        {{ t('match.distance', { distance: formatDistance(distance) }) }}
        {{
          COSTS.rule === null
            ? t('match.costsNoRules', { substitute: COSTS.substitute, delete: COSTS.delete, insert: COSTS.insert })
            : t('match.costs', { rule: COSTS.rule, substitute: COSTS.substitute, delete: COSTS.delete, insert: COSTS.insert })
        }}
      </p>
      <ul v-if="steps.length" class="mt-3 space-y-1.5">
        <li v-for="(step, k) in steps" :key="k" class="flex items-baseline justify-between gap-3">
          <span class="flex items-baseline gap-2">
            <code class="bg-muted rounded px-1 font-mono text-xs">{{ formatStep(step) }}</code>
            <span class="text-muted-foreground text-xs">{{ step.category ? categoryLabel(step.category) : opLabel(step.op) }}</span>
          </span>
          <span class="text-muted-foreground font-mono text-xs tabular-nums">+{{ formatDistance(step.cost) }}</span>
        </li>
      </ul>
      <RouterLink
        v-if="query && term"
        :to="{ name: 'lab', query: { a: query, b: term } }"
        class="text-primary mt-3 inline-block text-xs font-medium hover:underline"
      >
        {{ t('match.openLab') }}
      </RouterLink>
    </PopoverContent>
  </Popover>
</template>
