<script setup lang="ts">
/**
 * 由對應組檢索（實驗性；設定選單選了它）找到的命中的說明。按鈕與 BCDP 的命中長得一樣，讀者看到的分類不變：
 * - 相近拼寫：「≈ 距離」加前兩個不同處（與 MatchExplanation 相同）；
 * - 自動拆解、自動派生、自動同根：命中方式加詞的結構（與 MorphologyExplanation 相同）。
 * 點開才是對應組檢索自己的說明：把查詢當成哪個方言的詞、兩邊剝了哪些詞綴、詞幹的每個不同處是學到的語音對應
 * 還是沒見過的差異、各自的成本（已換算成與 BCDP 同一個刻度）。
 */
import type { CsrExplanation } from '@babizu/search/index.ts'
import { computed, type PropType } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { t } from '@/i18n.ts'
import { csrStepLabel, dialectLabel, formatAffix, formatDistance, formatStep, matchTypeLabel } from '@/lib/labels.ts'

const props = defineProps({
  csr: { type: Object as PropType<CsrExplanation>, required: true },
  /** 命中方式：fuzzy、lemma、derived、sibling */
  matchType: { type: String, required: true },
  distance: { type: Number, required: true },
  query: { type: String, default: '' },
  term: { type: String, default: '' },
})

const steps = computed(() => props.csr.steps ?? [])
/** 不同的地方（學到的對應、沒見過的差異） */
const differences = computed(() => steps.value.filter((s) => s.kind !== 'match'))
const matchCost = computed(() => steps.value.filter((s) => s.kind === 'match').reduce((sum, s) => sum + s.cost, 0))
const morphological = computed(() => props.matchType !== 'fuzzy')
/** 詞的結構：前綴、重疊、中綴在詞幹前，後綴在後（mu- + tuu、tuu + -an） */
const structure = (stem: string, affixes: CsrExplanation['queryAffixes']) =>
  [...affixes.filter((a) => a.type !== 'suffix').map(formatAffix), stem, ...affixes.filter((a) => a.type === 'suffix').reverse().map(formatAffix)].join(' + ')
const summary = computed(() => {
  if (props.matchType === 'lemma') return structure(props.csr.entryStem, props.csr.queryAffixes)
  if (props.matchType === 'derived') return structure(props.csr.queryStem, props.csr.entryAffixes)
  if (props.matchType === 'sibling') return props.csr.entryStem
  return differences.value.slice(0, 2).map((s) => formatStep(s)).join(t('、'))
})
/** 全部是學到的對應（沒有沒見過的差異）時，相近拼寫的按鈕用較明顯的樣式（與方言規則的相近拼寫一致） */
const allLearned = computed(() => differences.value.length > 0 && differences.value.every((s) => s.kind === 'correspondence'))
const title = computed(() =>
  props.matchType === 'lemma' ? t('自動拆解的說明') : props.matchType === 'derived' ? t('自動派生的說明') : props.matchType === 'sibling' ? t('自動同根的說明') : t('為什麼算相近？'),
)
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Badge
        v-if="morphological"
        as="button"
        type="button"
        size="tag"
        variant="inferred"
        class="max-w-full cursor-pointer"
        :aria-label="t('{label}：{summary}，查看說明', { label: matchTypeLabel(matchType), summary })"
        @click.stop.prevent
      >
        <span>{{ matchTypeLabel(matchType) }}</span>
        <span class="native-text truncate font-normal">{{ summary }}</span>
        <span v-if="differences.length" class="text-accent-foreground/70 font-normal" aria-hidden="true">≈</span>
      </Badge>
      <Badge
        v-else
        as="button"
        type="button"
        size="tag"
        :variant="allLearned ? 'soft' : 'quiet'"
        class="max-w-full cursor-pointer"
        :aria-label="t('相近拼寫，距離 {distance}，查看說明', { distance: formatDistance(distance) })"
        @click.stop.prevent
      >
        <span class="tabular-nums">≈ {{ formatDistance(distance) }}</span>
        <span v-if="summary" class="truncate font-normal">{{ summary }}</span>
      </Badge>
    </PopoverTrigger>
    <PopoverContent class="w-72 text-sm" align="start" @click.stop>
      <div class="flex items-center justify-between gap-2">
        <p class="font-medium">{{ title }}</p>
        <Badge size="tag" variant="inferred" class="shrink-0">{{ t('對應組檢索（實驗）') }}</Badge>
      </div>
      <p class="native-text mt-1.5 text-base leading-tight">{{ csr.queryStem }} ↔ {{ csr.entryStem }}</p>
      <p class="text-muted-foreground mt-1 text-xs">
        {{ t('把查詢當成{query}的詞，比對{entry}的詞。', { query: dialectLabel(csr.queryDialect), entry: dialectLabel(csr.entryDialect) }) }}
      </p>
      <ul v-if="csr.queryAffixes.length || csr.entryAffixes.length" class="mt-2 space-y-1 text-xs">
        <li v-if="csr.queryAffixes.length" class="flex items-baseline gap-2">
          <span class="text-muted-foreground">{{ t('查詢剝掉') }}</span>
          <code v-for="(a, k) in csr.queryAffixes" :key="k" class="bg-muted native-text rounded px-1">{{ formatAffix(a) }}</code>
        </li>
        <li v-if="csr.entryAffixes.length" class="flex items-baseline gap-2">
          <span class="text-muted-foreground">{{ t('這個詞剝掉') }}</span>
          <code v-for="(a, k) in csr.entryAffixes" :key="k" class="bg-muted native-text rounded px-1">{{ formatAffix(a) }}</code>
        </li>
        <li class="text-muted-foreground flex justify-between">
          <span>{{ t('詞綴') }}</span>
          <span class="font-mono tabular-nums">+{{ formatDistance(csr.affixCost) }}</span>
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
