<script setup>
/**
 * 構詞命中的說明：詞根相符（查 mudaux → daux）或衍生形（查 baket → binaket）。
 * 按鈕顯示詞綴結構的摘要（「mu- + daux」），點開列出每個構詞步驟與語法說明。
 */
import { computed } from 'vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { t } from '@/i18n.js'
import { formatDistance, formatMorphStep, morphGloss, morphStepLabel, morphSummary } from '@/lib/labels.js'

const props = defineProps({
  /** search 引擎的 LemmaAnalysis：{ stem, steps, cost } */
  analysis: { type: Object, required: true },
  /** lemma（查詢去詞綴 → 這個詞）或 derived（這個詞去詞綴 → 查詢） */
  matchType: { type: String, required: true },
  query: { type: String, default: '' },
  /** 命中的詞庫詞 */
  term: { type: String, default: '' },
})

const summary = computed(() => morphSummary(props.analysis))
const intro = computed(() =>
  props.matchType === 'lemma'
    ? t('morph.lemmaIntro', { query: props.query, stem: props.analysis.stem })
    : t('morph.derivedIntro', { term: props.term, stem: props.analysis.stem }),
)
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <button
        type="button"
        class="bg-accent text-accent-foreground hover:bg-accent/80 inline-flex h-5 max-w-full items-center gap-1 rounded px-1.5 text-[11px] leading-none whitespace-nowrap transition-colors"
        :aria-label="t('morph.explainButton', { label: t(`matchType.${matchType}`), summary })"
        @click.stop.prevent
      >
        <span class="font-medium">{{ t(`matchType.${matchType}`) }}</span>
        <span class="native-text truncate">{{ summary }}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-72 text-sm" align="start" @click.stop>
      <p class="font-medium">{{ t('morph.title') }}</p>
      <p class="text-muted-foreground mt-1 text-xs">{{ intro }}</p>
      <ul class="mt-3 space-y-1.5">
        <li v-for="(step, k) in analysis.steps" :key="k" class="flex items-baseline justify-between gap-3">
          <span class="flex min-w-0 items-baseline gap-2">
            <code class="bg-muted native-text rounded px-1 text-xs">{{ formatMorphStep(step) }}</code>
            <span class="text-muted-foreground truncate text-xs">
              {{ morphStepLabel(step.type) }}<template v-if="morphGloss(step.gloss)"> · {{ morphGloss(step.gloss) }}</template>
            </span>
          </span>
          <span class="text-muted-foreground font-mono text-xs tabular-nums">+{{ formatDistance(step.cost) }}</span>
        </li>
      </ul>
      <p class="text-muted-foreground mt-3 text-xs">{{ t('morph.note') }}</p>
    </PopoverContent>
  </Popover>
</template>
