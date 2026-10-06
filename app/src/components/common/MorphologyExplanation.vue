<script setup>
/**
 * 構詞命中的說明：自動拆解（查 mudaux → daux）或自動派生（查 baket → binaket）。兩者都是演算法（BCDP）推定的，
 * 說明的末尾一律寫明，並連到演算法實驗室重現同一個計算。
 * 按鈕顯示詞綴結構的摘要（「mu- + daux」），點開列出：
 * - 每個構詞步驟與語法說明、步驟本身的成本。構詞文法的組合規則（m<a>-…-ay）另外列出由哪些詞素構成
 * - 整個詞一起比對的音變（docs/bcdp.md 1.2）：每一個標出落在前綴、詞幹、後綴，或詞素交界
 *   （例如 takitaw 的 aa → a 跨越詞幹與後綴的交界）
 * - 自動派生經過其他詞時（上一層本身也是自動派生的），逐層列出上面幾層
 * - 由查詢的相近寫法出發時（寬鬆查 sugut，經 sungut），列出兩者的差異
 * - 自動同根：兩個詞推定來自同一個詞根，分別列出查詢怎麼拆到它、這個詞怎麼由它衍生。
 *   詞根可以是詞庫中的詞（查 masamian 找到 musamian，詞根 samian），或詞庫外的虛擬詞根
 *   （查 binubuer 找到 mabubuer，詞根 bubuer；另列「詞庫外的詞根」的代價）
 * - 句型搜尋的構詞樣式比對的是依模糊程度取到的拆法（babizu/pattern 的 PARSE_SELECTION），
 *   不是這個詞最好的拆法時（analysis.bestCost 比 cost 小）標「次佳」並說明；詞根是虛擬詞根時（analysis.virtual）說明它不在詞庫中
 */
import { computed } from 'vue'
import { InfoIcon } from '@lucide/vue'
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

/** 句型搜尋：比到的是次佳的拆法（這個詞最好的拆法成本較低） */
const alternative = computed(() => props.analysis.bestCost !== undefined && props.analysis.cost > props.analysis.bestCost + 1e-9)
/** 自動同根：查詢拆出的虛擬詞根與拆法（見 babizu/search 的 LemmaAnalysis.sibling） */
const sibling = computed(() => /** @type {{root: string, steps: any[], cost: number, penalty: number, lexical?: boolean} | null} */ (props.analysis.sibling ?? null))
const summary = computed(() => (sibling.value ? sibling.value.root : morphSummary(props.analysis)))
const intro = computed(() =>
  props.matchType === 'lemma'
    ? t('{query} → {stem}', { query: props.query, stem: props.analysis.stem })
    : sibling.value
      ? t('{query}、{term} → {stem}', { query: props.query, term: props.term, stem: sibling.value.root })
      : t('{term} → {stem}', { term: props.term, stem: props.analysis.stem }),
)
/** 整個詞的音變（只為前幾筆結果計算，其餘為 null） */
const notes = computed(() => /** @type {Array<{op: string, source: string, target: string, cost: number, category: string | null, where: string}>} */ (props.analysis.notes ?? []))
const soundCost = computed(() => notes.value.reduce((sum, n) => sum + n.cost, 0))
/** @param {Array<{cost: number}>} steps */
const stepCost = (steps) => steps.reduce((sum, s) => sum + s.cost, 0)
/** 自動派生經過的上層（由起點往下；不含最後一層，那一層就是 stem、steps） */
const chain = computed(() => /** @type {Array<{term: string, stem: string, steps: any[], cost: number, rootCost?: number}>} */ (props.analysis.chain ?? []))
/** 詞根依音節數的成本（語言設定檔 rootSyllableCost）：不是音變 */
const rootCost = computed(() => props.analysis.rootCost ?? 0)
/** 這一層本身的成本：總成本扣掉起點的距離（相近寫法、自動同根的拆解與代價）與上面幾層 */
const ownCost = computed(
  () =>
    props.analysis.cost -
    (props.analysis.variantDistance ?? 0) -
    (sibling.value ? sibling.value.cost + sibling.value.penalty : 0) -
    chain.value.reduce((sum, c) => sum + c.cost, 0),
)
/** 任何一層有音變，或起點是查詢的相近寫法 */
const hasSoundChange = computed(
  () =>
    notes.value.length > 0 ||
    (props.analysis.variantDistance ?? 0) > 0 ||
    ownCost.value > stepCost(props.analysis.steps) + rootCost.value + 1e-9 ||
    chain.value.some((c) => c.cost > stepCost(c.steps) + (c.rootCost ?? 0) + 1e-9),
)
/** 起點（詞庫中的詞根）：有上層時是最上面那一層的詞根 */
const root = computed(() => chain.value[0]?.stem ?? props.analysis.stem)
const derived = computed(() => props.matchType === 'derived')
/**
 * 實驗室重現同一個計算：自動拆解是「查詢 → 詞根」；自動派生的最後一層是「這個詞 → 上一層」
 * （建置時就是這樣對每個詞跑 BCDP，求得最好的詞根）。自動同根的詞根不在詞庫中，實驗室重現不了
 */
const lab = computed(() => {
  if (props.analysis.virtual) return null
  // 自動同根：詞根在詞庫中時，最後一層（這個詞 → 上一層）與自動派生相同；虛擬詞根不在詞庫中，重現不了
  if (sibling.value) return sibling.value.lexical && props.term ? { q: props.term, t: props.analysis.stem } : null
  if (derived.value) return props.term ? { q: props.term, t: props.analysis.stem } : null
  return props.query && props.term ? { q: props.query, t: props.term } : null
})
const title = computed(() => (sibling.value ? t('自動同根的說明') : derived.value ? t('自動派生的說明') : t('自動拆解的說明')))
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
        variant="inferred"
        class="max-w-full cursor-pointer"
        :aria-label="t('{label}：{summary}，查看說明', { label: alternative ? `${matchTypeLabel(matchType)} · ${t('次佳')}` : matchTypeLabel(matchType), summary })"
        @click.stop.prevent
      >
        <span>{{ matchTypeLabel(matchType) }}<template v-if="alternative"> · {{ t('次佳') }}</template></span>
        <span class="native-text truncate font-normal">{{ summary }}</span>
        <span v-if="hasSoundChange" class="text-accent-foreground/70 font-normal" aria-hidden="true">≈</span>
      </Badge>
    </PopoverTrigger>
    <PopoverContent class="w-72 text-sm" align="start" @click.stop>
      <div class="flex items-center justify-between gap-2">
        <p class="font-medium">{{ title }}</p>
        <Badge size="tag" variant="inferred" class="shrink-0">{{ t('演算法推定') }}</Badge>
      </div>
      <!-- 查詢 → 詞根，接著說明這是演算法推定的結果，不是分析標註 -->
      <p class="native-text mt-1.5 text-base leading-tight">{{ intro }}</p>
      <p v-if="alternative" class="text-muted-foreground mt-1 text-xs">
        {{ t('這不是這個詞最好的拆法（最好的成本 {best}，這一種 {cost}）。句型搜尋依模糊程度也比對次佳的拆法。', { best: formatDistance(analysis.bestCost), cost: formatDistance(analysis.cost) }) }}
      </p>
      <p v-if="analysis.virtual" class="text-muted-foreground mt-1 text-xs">
        {{ t('詞根「{root}」不在詞庫中，是演算法由詞形拆出來的。', { root: analysis.stem }) }}
      </p>
      <div v-if="analysis.variantOf" class="text-muted-foreground mt-1 text-xs">
        <p>{{ t('查詢「{query}」與詞庫中的「{root}」寫法相近，由「{root}」自動派生。', { query: analysis.variantOf, root }) }}</p>
        <p v-if="analysis.variantNotes?.length" class="mt-0.5 flex flex-wrap items-baseline gap-x-2">
          <code v-for="(n, k) in analysis.variantNotes" :key="k" class="bg-muted native-text rounded px-1">{{ formatStep(n) }}</code>
          <span class="font-mono tabular-nums">+{{ formatDistance(analysis.variantDistance) }}</span>
        </p>
      </div>
      <!-- 自動同根：詞根不在詞庫中；先列出查詢怎麼拆到它，下面是這個詞怎麼由它衍生 -->
      <div v-if="sibling" class="mt-1 text-xs">
        <p class="text-muted-foreground">
          {{
            sibling.lexical
              ? t('兩個詞推定來自同一個詞根「{root}」（詞庫中的詞）。', { root: sibling.root })
              : t('兩個詞推定來自同一個詞根「{root}」。這個詞根不在詞庫中，是演算法由詞形拆出來的。', { root: sibling.root })
          }}
        </p>
        <ul class="border-border mt-1.5 ml-1 space-y-0.5 border-l pl-2">
          <li class="flex items-baseline justify-between gap-3">
            <span class="native-text min-w-0">{{ query }} ＝ {{ morphSummary({ stem: sibling.root, steps: sibling.steps }) }}</span>
            <span class="text-muted-foreground font-mono tabular-nums">+{{ formatDistance(sibling.cost) }}</span>
          </li>
          <li v-if="!sibling.lexical" class="flex items-baseline justify-between gap-3">
            <span class="text-muted-foreground min-w-0">{{ t('詞庫外的詞根') }}</span>
            <span class="text-muted-foreground font-mono tabular-nums">+{{ formatDistance(sibling.penalty) }}</span>
          </li>
        </ul>
        <p class="text-muted-foreground mt-2">{{ t('「{term}」由「{root}」衍生：', { term, root: sibling.root }) }}</p>
      </div>
      <!-- 經過其他衍生詞：先列出上面幾層（由詞根往下），下面的步驟是最後一層 -->
      <div v-if="chain.length" class="mt-2">
        <p class="text-muted-foreground text-xs">{{ t('「{stem}」本身也是由「{root}」自動派生：', { stem: analysis.stem, root }) }}</p>
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
        <li v-if="rootCost > 0" class="flex items-baseline justify-between gap-3">
          <span class="text-muted-foreground text-xs">{{ t('詞根「{root}」的音節數', { root: analysis.stem }) }}</span>
          <span class="text-muted-foreground font-mono text-xs tabular-nums">+{{ formatDistance(rootCost) }}</span>
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
      <!-- 合計：上面各項（含相近寫法、上面幾層、詞庫外的詞根）加起來就是排序用的成本 -->
      <div class="border-border mt-2 flex items-baseline justify-between gap-3 border-t pt-1.5 text-xs">
        <span class="text-muted-foreground">{{ t('合計') }}</span>
        <span class="font-mono font-medium tabular-nums">{{ formatDistance(analysis.cost) }}</span>
      </div>
      <p class="text-muted-foreground bg-muted/60 mt-3 flex gap-1.5 rounded-md px-2 py-1.5 text-xs leading-relaxed">
        <InfoIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
        {{
          sibling
            ? t('此為演算法推定兩個詞來自同一個詞根，不是辭典的標註，僅用於方便檢索。您需要自行判斷正確性。')
            : derived
              ? t('此為演算法推定這個詞由上面的詞加上詞綴而來，不是辭典的標註，僅用於方便檢索。您需要自行判斷正確性。')
              : t('此為演算法自動去除詞綴後所得到的結果，僅用於方便檢索，並非確定的分析標註。您需要自行判斷正確性。')
        }}</span>
      </p>
      <!-- 兩個方向都是構詞搜尋（BCDP）算出來的：連到實驗室的構詞分頁逐步觀察 -->
      <RouterLink
        v-if="lab"
        :to="{ name: 'lab', query: { tab: 'bcdp', ...lab } }"
        class="text-primary mt-2 inline-flex min-h-8 items-center text-xs underline-offset-2 hover:underline"
      >
        {{ t('查看演算法運作方式 →') }}
      </RouterLink>
    </PopoverContent>
  </Popover>
</template>
