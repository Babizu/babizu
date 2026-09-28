<script setup>
/**
 * 構詞命中的說明：自動拆解（查 mudaux → daux）或衍生形（查 baket → binaket）。
 * 按鈕顯示詞綴結構的摘要（「mu- + daux」），點開列出：
 * - 每個構詞步驟與語法說明、步驟本身的成本。構詞文法的組合規則（m<a>-…-ay）另外列出由哪些詞素構成
 * - 整個詞一起比對的音變（docs/bcdp.md 1.2）：每一個標出落在前綴、詞幹、後綴，或詞素交界
 *   （例如 takitaw 的 aa → a 跨越詞幹與後綴的交界）
 * - 衍生形經過其他衍生詞時（查 sungut 找到 pausunguday，經 pusungut），逐層列出上面幾層
 * - 由查詢的相近寫法出發時（寬鬆查 sugut，經 sungut），列出兩者的差異
 */
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { t } from '@/i18n.js'
import {
  categoryLabel,
  matchTypeLabel,
  morphWhereLabel,
  formatDistance,
  formatMorphStep,
  formatStep,
  morphGloss,
  morphStepLabel,
  morphSummary,
  opLabel,
} from '@/lib/labels.js'

const props = defineProps({
  /** search 引擎的 LemmaAnalysis：{ stem, steps, cost, notes?, chain?, variantOf?, variantDistance?, variantNotes? } */
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
    ? t('{query} → {stem}', { query: props.query, stem: props.analysis.stem })
    : t('{term} → {stem}', { term: props.term, stem: props.analysis.stem }),
)
/** 整個詞的音變（只為前幾筆結果計算，其餘為 null） */
const notes = computed(() => /** @type {Array<{op: string, source: string, target: string, cost: number, category: string | null, where: string}>} */ (props.analysis.notes ?? []))
const soundCost = computed(() => notes.value.reduce((sum, n) => sum + n.cost, 0))
/** @param {Array<{cost: number}>} steps */
const stepCost = (steps) => steps.reduce((sum, s) => sum + s.cost, 0)
/** 衍生形經過的上層（由起點往下；不含最後一層，那一層就是 stem、steps） */
const chain = computed(() => /** @type {Array<{term: string, stem: string, steps: any[], cost: number}>} */ (props.analysis.chain ?? []))
/** 這一層本身的成本：總成本扣掉起點的距離與上面幾層 */
const ownCost = computed(() => props.analysis.cost - (props.analysis.variantDistance ?? 0) - chain.value.reduce((sum, c) => sum + c.cost, 0))
/** 任何一層有音變，或起點是查詢的相近寫法 */
const hasSoundChange = computed(
  () =>
    notes.value.length > 0 ||
    (props.analysis.variantDistance ?? 0) > 0 ||
    ownCost.value > stepCost(props.analysis.steps) + 1e-9 ||
    chain.value.some((c) => c.cost > stepCost(c.steps) + 1e-9),
)
/** 起點（詞庫中的詞根）：有上層時是最上面那一層的詞根 */
const root = computed(() => chain.value[0]?.stem ?? props.analysis.stem)
/** 步驟的名稱：由幾個詞素構成的（構詞文法的組合規則）顯示「組合規則」，其他依類型 @param {any} step */
const stepLabel = (step) => morphStepLabel(step.parts?.length > 1 ? 'construction' : step.type)
/** 詞素的寫法（組合規則展開的每一個詞素） @param {{type: string, form: string}} part @param {number} k */
const partLabel = (part, k) => (part.type === 'prefix' ? `${part.form}-` : part.type === 'suffix' ? `-${part.form}` : part.type === 'infix' ? `<${part.form}>` : k === 0 ? `${part.form}~` : part.form)
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Badge
        as="button"
        type="button"
        size="tag"
        variant="soft"
        class="max-w-full cursor-pointer"
        :aria-label="t('{label}：{summary}，查看拆解說明', { label: matchTypeLabel(matchType), summary })"
        @click.stop.prevent
      >
        <span>{{ matchTypeLabel(matchType) }}</span>
        <span class="native-text truncate font-normal">{{ summary }}</span>
        <span v-if="hasSoundChange" class="text-accent-foreground/70 font-normal" aria-hidden="true">≈</span>
      </Badge>
    </PopoverTrigger>
    <PopoverContent class="w-72 text-sm" align="start" @click.stop>
      <p class="font-medium">{{ t('拆解說明') }}</p>
      <!-- 查詢 → 詞根，接著說明這是演算法推定的結果，不是分析標註 -->
      <p class="native-text mt-1.5 text-base leading-tight">{{ intro }}</p>
      <div v-if="analysis.variantOf" class="text-muted-foreground mt-1 text-xs">
        <p>{{ t('查詢「{query}」與詞庫中的「{root}」寫法相近，由「{root}」找衍生形。', { query: analysis.variantOf, root }) }}</p>
        <p v-if="analysis.variantNotes?.length" class="mt-0.5 flex flex-wrap items-baseline gap-x-2">
          <code v-for="(n, k) in analysis.variantNotes" :key="k" class="bg-muted native-text rounded px-1">{{ formatStep(n) }}</code>
          <span class="font-mono tabular-nums">+{{ formatDistance(analysis.variantDistance) }}</span>
        </p>
      </div>
      <!-- 經過其他衍生詞：先列出上面幾層（由詞根往下），下面的步驟是最後一層 -->
      <div v-if="chain.length" class="mt-2">
        <p class="text-muted-foreground text-xs">{{ t('「{stem}」本身是「{root}」的衍生形：', { stem: analysis.stem, root }) }}</p>
        <ul class="border-border mt-1 ml-1 space-y-0.5 border-l pl-2">
          <li v-for="(level, k) in chain" :key="k" class="flex items-baseline justify-between gap-3 text-xs">
            <span class="native-text min-w-0">{{ level.term }} ＝ {{ morphSummary(level) }}</span>
            <span class="text-muted-foreground font-mono tabular-nums">+{{ formatDistance(level.cost) }}</span>
          </li>
        </ul>
      </div>
      <ul class="mt-3 space-y-1.5">
        <li v-for="(step, k) in analysis.steps" :key="k">
          <div class="flex items-baseline justify-between gap-3">
            <span class="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <code class="bg-muted native-text rounded px-1 text-xs">{{ formatMorphStep(step) }}</code>
              <span class="text-muted-foreground text-xs">
                {{ stepLabel(step) }}<template v-if="morphGloss(step.gloss)"> · {{ morphGloss(step.gloss) }}</template>
              </span>
            </span>
            <span class="text-muted-foreground font-mono text-xs tabular-nums">+{{ formatDistance(step.cost) }}</span>
          </div>
          <!-- 由詞素構成的步驟：依推導順序列出每一個詞素與它的說明 -->
          <ul v-if="step.parts && step.parts.length > 1" class="border-border mt-1 ml-1 space-y-0.5 border-l pl-2">
            <li v-for="(part, j) in step.parts" :key="j" class="flex flex-wrap items-baseline gap-x-2 text-xs">
              <code class="native-text">{{ partLabel(part, j) }}</code>
              <span class="text-muted-foreground">{{ morphStepLabel(part.type) }}<template v-if="morphGloss(part.gloss)"> · {{ morphGloss(part.gloss) }}</template></span>
            </li>
          </ul>
        </li>
        <li v-if="notes.length" class="flex items-baseline justify-between gap-3">
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="text-muted-foreground text-xs">{{ t('音變（整個詞一起比對）') }}</span>
            <span v-for="(n, k) in notes" :key="k" class="flex flex-wrap items-baseline gap-x-2 text-xs">
              <code class="bg-muted native-text rounded px-1">{{ formatStep(n) }}</code>
              <span class="text-muted-foreground">{{ n.category ? categoryLabel(n.category) : opLabel(n.op) }} · {{ morphWhereLabel(n.where) }}</span>
            </span>
          </span>
          <span class="text-muted-foreground font-mono text-xs tabular-nums">+{{ formatDistance(soundCost) }}</span>
        </li>
      </ul>
      <p class="text-muted-foreground mt-1 text-xs leading-relaxed">{{ t('此為演算法自動去除詞綴後所得到的結果，僅用於方便檢索，並非確定的分析標註。您需要自行判斷正確性。') }}</p>
      <!-- 自動拆解是構詞搜尋（BCDP）找到的：連到實驗室的構詞分頁逐步觀察 -->
      <RouterLink
        v-if="matchType === 'lemma' && query && term"
        :to="{ name: 'lab', query: { tab: 'bcdp', q: query, t: term } }"
        class="text-primary mt-2 inline-flex min-h-8 items-center text-xs underline-offset-2 hover:underline"
      >
        {{ t('查看演算法運作方式 →') }}
      </RouterLink>
    </PopoverContent>
  </Popover>
</template>
