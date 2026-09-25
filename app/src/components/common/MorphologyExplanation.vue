<script setup>
/**
 * 構詞命中的說明：詞根相符（查 mudaux → daux）或衍生形（查 baket → binaket）。
 * 按鈕顯示詞綴結構的摘要（「mu- + daux」），點開列出：
 * - 每個構詞步驟與語法說明；詞綴本身有音變時註明查詢中的寫法（mine- ≈ minu-）
 * - 詞幹的音變（dox → daux：o→au 元音）
 */
import { computed } from 'vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { t } from '@/i18n.js'
import {
  categoryLabel,
  formatDistance,
  formatMorphStep,
  formatStep,
  morphGloss,
  morphStepLabel,
  morphSummary,
  opLabel,
} from '@/lib/labels.js'

const props = defineProps({
  /** search 引擎的 LemmaAnalysis：{ stem, steps, cost, stemSurface?, stemDistance?, stemAlignment? } */
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
/** 詞幹的音變：詞根相符時是「查詢中的詞幹 → 詞庫詞幹」，衍生形時是「查詢 → 方言變體詞幹」 */
const stemChange = computed(() => {
  const a = props.analysis
  if (!a.stemSurface || a.stemSurface === a.stem) return null
  return {
    from: a.stemSurface,
    to: a.stem,
    cost: a.stemDistance ?? 0,
    notes: /** @type {Array<{op: string, source: string, target: string, category: string | null}>} */ (a.stemAlignment ?? []),
  }
})
const hasSoundChange = computed(() => !!stemChange.value || props.analysis.steps.some((s) => s.surface))
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
        <span v-if="hasSoundChange" class="text-accent-foreground/70" aria-hidden="true">≈</span>
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-72 text-sm" align="start" @click.stop>
      <p class="font-medium">{{ t('morph.title') }}</p>
      <p class="text-muted-foreground mt-1 text-xs">{{ intro }}</p>
      <ul class="mt-3 space-y-1.5">
        <li v-for="(step, k) in analysis.steps" :key="k" class="flex items-baseline justify-between gap-3">
          <span class="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <code class="bg-muted native-text rounded px-1 text-xs">{{ formatMorphStep(step) }}</code>
            <span class="text-muted-foreground text-xs">
              {{ morphStepLabel(step.type) }}<template v-if="morphGloss(step.gloss)"> · {{ morphGloss(step.gloss) }}</template>
            </span>
            <span v-if="step.surface" class="text-muted-foreground w-full text-xs">
              {{ t('morph.surface', { surface: formatMorphStep({ ...step, form: step.surface }) }) }}
            </span>
          </span>
          <span class="text-muted-foreground font-mono text-xs tabular-nums">+{{ formatDistance(step.cost) }}</span>
        </li>
        <li v-if="stemChange" class="flex items-baseline justify-between gap-3">
          <span class="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <code class="bg-muted native-text rounded px-1 text-xs">{{ stemChange.from }} → {{ stemChange.to }}</code>
            <span class="text-muted-foreground text-xs">{{ t('morph.stemChange') }}</span>
            <span v-if="stemChange.notes.length" class="text-muted-foreground w-full text-xs">
              {{
                stemChange.notes
                  .map((s) => `${formatStep(s)} ${s.category ? categoryLabel(s.category) : opLabel(s.op)}`)
                  .join(t('common.listSeparator'))
              }}
            </span>
          </span>
          <span class="text-muted-foreground font-mono text-xs tabular-nums">+{{ formatDistance(stemChange.cost) }}</span>
        </li>
      </ul>
      <p class="text-muted-foreground mt-3 text-xs">{{ t('morph.note') }}</p>
      <!-- 詞根相符是構詞搜尋（BCDP）找到的：連到實驗室的構詞分頁逐步觀察 -->
      <RouterLink
        v-if="matchType === 'lemma' && query && term"
        :to="{ name: 'lab', query: { tab: 'bcdp', q: query, t: term } }"
        class="text-primary mt-2 inline-flex min-h-8 items-center text-xs underline-offset-2 hover:underline"
      >
        {{ t('morph.labLink') }}
      </RouterLink>
    </PopoverContent>
  </Popover>
</template>
