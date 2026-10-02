<script setup>
/**
 * 搜尋篩選：搜尋範圍、模糊程度、搜尋方法、來源、語言變體（方言）、語言單位。
 * 桌面放在側欄（窄），行動裝置放在底部抽屜（寬）——同一個元件。
 *
 * 版面依**容器**寬度而不是視窗寬度決定欄數（`@container` 加 `auto-fill`），
 * 所以同一份標記在 15rem 的側欄裡是一欄、在抽屜裡自動變成兩三欄，
 * 不必為兩個位置各寫一套。
 */
import { computed, ref } from 'vue'
import { ChevronDownIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { UNIT_CODES } from '@babizu/schema/constants.js'
import { useSources } from '@/composables/useSources.js'
import { t } from '@/i18n.js'
import { dialectLabel, FIELD_LABELS, formatCount, fuzzinessLabel, orderedVarieties, SEARCH_METHOD_GROUPS, site, unitLabel } from '@/lib/labels.js'

/**
 * @typedef {object} FilterState
 * @property {string[]} fields 搜尋範圍：native 族語、gloss 釋義（可複選）
 * @property {'exact' | 'normal' | 'loose'} fuzziness
 * @property {string[]} sources
 * @property {string[]} dialects
 * @property {string[]} units
 * @property {string[]} exclude 不要的搜尋方法（babizu/search 的 SEARCH_METHODS）
 */

const model = defineModel({ type: Object, required: true })
const props = defineProps({
  /** 每種搜尋方法找得到幾筆（搜尋回應的 methods；還沒有結果時為 null） */
  counts: { type: Object, default: null },
  /** 每一組搜尋方法找得到幾筆（搜尋回應的 methodGroups，組內各方法的聯集） */
  groupCounts: { type: Object, default: null },
  /** 句型搜尋：沒有「搜尋範圍」與「搜尋方法」（句型只比對族語，詞的條件由寫法決定） */
  pattern: { type: Boolean, default: false },
})
const { sources } = useSources()

/** 顯示名稱在模板裡用 t() 查，切換語系時才會即時更新 */
const FIELD_OPTIONS = ['native', 'gloss']

/** 模糊程度由鬆到緊排成一條強度軸，索引即滑桿位置 */
const FUZZINESS_STEPS = ['exact', 'normal', 'loose']

/**
 * 語言變體選項：下層變體緊接在上層之後（例如 巴宰 → 巴宰（愛蘭）），相鄰才看得出從屬關係。
 * 站台沒有定義任何變體時整個區塊不顯示。
 */
const VARIETY_CODES = [...orderedVarieties().map((v) => v.code), 'none']
const hasVarieties = site.varieties.length > 0
/** 有從屬關係的變體：篩選上層時會一併納入下層，要讓讀者知道 */
const nested = site.varieties.filter((v) => v.parent)

/** 選項格線：欄寬下限交給 auto-fill，容器有多寬就排幾欄 */
const GRID = 'grid gap-x-4 grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]'
const GRID_WIDE = 'grid gap-x-4 grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]'
const OPTION = 'hover:bg-muted flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2 -mx-2'
/** 搜尋方法的個別選項：收在組底下，比一般選項矮一點 */
const SUBOPTION = OPTION.replace('min-h-10', 'min-h-9')

const fuzzinessIndex = computed({
  get: () => [Math.max(0, FUZZINESS_STEPS.indexOf(model.value.fuzziness))],
  set: ([i]) => (model.value = { ...model.value, fuzziness: FUZZINESS_STEPS[i] }),
})
const currentFuzziness = computed(() => fuzzinessLabel(model.value.fuzziness ?? 'normal'))

/** @param {string} code */
const varietyOptionLabel = (code) => (code === 'none' ? t('未標方言') : dialectLabel(code))

const hasFilters = computed(
  () => model.value.sources.length > 0 || model.value.dialects.length > 0 || model.value.units.length > 0 || model.value.exclude.length > 0,
)

/** @param {string} id */
const included = (id) => !model.value.exclude.includes(id)
/** 一組的勾選狀態：全選、全不選或部分 @param {{methods: Array<{id: string}>}} g */
const groupState = (g) => {
  const n = g.methods.filter((m) => included(m.id)).length
  return n === g.methods.length ? true : n === 0 ? false : 'indeterminate'
}
/** 組名（含來源說明），供整組勾選框的無障礙名稱 @param {{label: string, note?: string}} g */
const groupName = (g) => (g.note ? t('{label}（{note}）', { label: t(g.label), note: t(g.note) }) : t(g.label))
/** 組內被排除的方法名稱（收合時寫在組名下面） @param {{methods: Array<{id: string, label: string}>}} g */
const excludedIn = (g) => g.methods.filter((m) => !included(m.id)).map((m) => t(m.label))
/**
 * 展開的組：預設收合，只顯示整組的勾選與筆數。一開始就有部分排除的組（例如網址帶 x=）展開，讀者看得到排除了哪幾個。
 * @type {import('vue').Ref<Set<string>>}
 */
const expanded = ref(new Set(SEARCH_METHOD_GROUPS.filter((g) => groupState(g) === 'indeterminate').map((g) => g.key)))
/** @param {string} key */
const toggleExpanded = (key) => {
  const next = new Set(expanded.value)
  if (!next.delete(key)) next.add(key)
  expanded.value = next
}
/** @param {string[]} exclude */
const setExclude = (exclude) => (model.value = { ...model.value, exclude })
/** @param {string} id @param {boolean | 'indeterminate'} checked */
const toggleMethod = (id, checked) => setExclude(checked === true ? model.value.exclude.filter((x) => x !== id) : [...model.value.exclude, id])
/** 整組切換：全選時全部排除，否則全部顯示 @param {{methods: Array<{id: string}>}} g */
const toggleGroup = (g) => {
  const ids = g.methods.map((m) => m.id)
  const rest = model.value.exclude.filter((x) => !ids.includes(x))
  setExclude(groupState(g) === true ? [...rest, ...ids] : rest)
}

/**
 * 切換清單中的一個值。
 * @param {'sources' | 'dialects' | 'units' | 'fields'} field
 * @param {string} value
 * @param {boolean | 'indeterminate'} checked
 */
function toggle(field, value, checked) {
  const list = model.value[field].filter((/** @type {string} */ v) => v !== value)
  if (checked === true) list.push(value)
  model.value = { ...model.value, [field]: list }
}

function reset() {
  model.value = { ...model.value, sources: [], dialects: [], units: [], exclude: [] }
}
</script>

<template>
  <div class="@container space-y-6 text-sm">
    <fieldset v-if="!props.pattern">
      <legend class="mb-2 font-medium">{{ t('搜尋範圍') }}</legend>
      <div :class="GRID">
        <label v-for="f in FIELD_OPTIONS" :key="f" :class="OPTION" :title="t(FIELD_LABELS[f].hint)">
          <Checkbox :model-value="model.fields.includes(f)" @update:model-value="(v) => toggle('fields', f, v)" />
          <span>{{ t(FIELD_LABELS[f].label) }}</span>
        </label>
      </div>
      <p v-if="model.fields.length === 0" class="text-destructive mt-1 text-xs">{{ t('請至少選擇一個搜尋範圍。') }}</p>
    </fieldset>

    <section>
      <div class="mb-3 flex items-baseline justify-between">
        <h3 id="filter-fuzziness" class="font-medium">{{ t('模糊程度') }}</h3>
        <span class="text-muted-foreground text-xs">{{ currentFuzziness }}</span>
      </div>
      <!--
        強度拉桿：三個停留點，刻度圓點畫在軌道上。
        圓點要對準滑鈕停下來的位置，而滑鈕中心只在「半個滑鈕寬」到「總寬減半個滑鈕寬」之間移動，
        所以用 calc 算，不能用 justify-between。
      -->
      <div class="relative">
        <Slider
          v-model="fuzzinessIndex"
          :min="0"
          :max="FUZZINESS_STEPS.length - 1"
          :step="1"
          aria-labelledby="filter-fuzziness"
:thumb-label="t('模糊程度')"
          :thumb-value-text="currentFuzziness"
        />
        <div class="pointer-events-none absolute inset-0" aria-hidden="true">
          <span
            v-for="(s, k) in FUZZINESS_STEPS"
            :key="s"
            class="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors"
            :class="k <= fuzzinessIndex[0] ? 'bg-primary-foreground/70' : 'bg-muted-foreground/40'"
            :style="{ left: `calc(0.625rem + (100% - 1.25rem) * ${k / (FUZZINESS_STEPS.length - 1)})` }"
          />
        </div>
      </div>
      <div class="text-muted-foreground mt-1 flex justify-between text-xs">
        <button
          v-for="s in FUZZINESS_STEPS"
          :key="s"
          type="button"
          class="hover:text-foreground min-h-8 transition-colors"
          :class="model.fuzziness === s && 'text-foreground font-medium'"
          @click="model = { ...model, fuzziness: s }"
        >
          {{ fuzzinessLabel(s) }}
        </button>
      </div>
      <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
        {{ t('「標準」會找出方言間的語音對應與少量拼寫差異；「精確」只比對拼寫正規化後相同的詞。不論哪一種，都會另外列出開頭、結尾相符與包含查詢字串的詞。') }}
      </p>
    </section>

    <!--
      搜尋方法：四組。每組一列（整組勾選、組名與來源、整組筆數、展開鈕），個別的方法收在底下，預設收合。
      筆數不受排除影響：排除掉的方法有多少仍看得到。
    -->
    <fieldset v-if="!props.pattern">
      <legend class="mb-1 flex w-full items-baseline justify-between gap-2 font-medium">
        <span>{{ t('搜尋方法') }}</span>
        <button v-if="model.exclude.length" type="button" class="text-primary min-h-8 text-xs font-normal hover:underline" @click="setExclude([])">
          {{ t('全部顯示') }}
        </button>
      </legend>
      <div v-for="g in SEARCH_METHOD_GROUPS" :key="g.key">
        <div class="-mx-2 flex items-center gap-1">
          <label class="hover:bg-muted flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2 transition-colors">
            <Checkbox :model-value="groupState(g)" :aria-label="t('整組：{group}', { group: groupName(g) })" @update:model-value="() => toggleGroup(g)" />
            <span class="flex min-w-0 flex-1 flex-col py-1.5 leading-tight">
              <span class="flex items-baseline gap-1.5">
                <span :class="groupState(g) === false && 'text-muted-foreground'">{{ t(g.label) }}</span>
                <span v-if="g.note" class="text-muted-foreground truncate text-xs">{{ t(g.note) }}</span>
              </span>
              <span v-if="!expanded.has(g.key) && groupState(g) === 'indeterminate'" class="text-muted-foreground mt-0.5 truncate text-xs">
                {{ t('不含 {methods}', { methods: excludedIn(g).join(t('、')) }) }}
              </span>
            </span>
            <span v-if="props.groupCounts" class="text-muted-foreground text-xs tabular-nums">{{ formatCount(props.groupCounts[g.key] ?? 0) }}</span>
          </label>
          <button
            type="button"
            class="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 grid size-8 shrink-0 place-items-center rounded-md transition-colors outline-none focus-visible:ring-[3px]"
            :aria-expanded="expanded.has(g.key)"
            :aria-controls="`filter-methods-${g.key}`"
            :aria-label="t('{group}的個別方法', { group: groupName(g) })"
            @click="toggleExpanded(g.key)"
          >
            <ChevronDownIcon class="size-4 transition-transform duration-200 motion-reduce:transition-none" :class="expanded.has(g.key) && 'rotate-180'" aria-hidden="true" />
          </button>
        </div>
        <!--
          收合用 grid-template-rows 0fr ↔ 1fr 做高度動畫。收合時 inert（鍵盤不會跳進看不見的選項），
          動畫結束後 visibility: hidden（visibility 的轉場在結束時才切換），輔助技術也不會讀到
        -->
        <div
          :id="`filter-methods-${g.key}`"
          class="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
          :class="expanded.has(g.key) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
          :inert="!expanded.has(g.key)"
        >
          <div class="overflow-hidden transition-[visibility] duration-200 motion-reduce:transition-none" :class="!expanded.has(g.key) && 'invisible'">
            <!-- 右邊留出展開鈕的寬度（size-8 ＋ gap-1），個別方法的筆數與整組的筆數對齊 -->
            <div :class="GRID" class="border-border mr-9 mb-1 ml-[0.4375rem] border-l pl-3.5">
              <label v-for="m in g.methods" :key="m.id" :class="[SUBOPTION, props.counts && !props.counts[m.id] && 'text-muted-foreground']" :title="t(m.hint)">
                <Checkbox :model-value="included(m.id)" @update:model-value="(v) => toggleMethod(m.id, v)" />
                <span class="min-w-0 flex-1 truncate">{{ t(m.label) }}</span>
                <span v-if="props.counts" class="text-muted-foreground text-xs tabular-nums">{{ formatCount(props.counts[m.id] ?? 0) }}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </fieldset>

    <fieldset>
      <legend class="mb-2 font-medium">{{ t('資料來源') }}</legend>
      <div :class="GRID_WIDE">
        <label v-for="s in sources" :key="s.id" :class="OPTION">
          <Checkbox :model-value="model.sources.includes(s.id)" @update:model-value="(v) => toggle('sources', s.id, v)" />
          <span class="truncate" :title="s.shortTitle">{{ s.shortTitle }}</span>
        </label>
      </div>
    </fieldset>

    <fieldset v-if="hasVarieties">
      <legend class="mb-2 font-medium">{{ t('方言') }}</legend>
      <div :class="GRID">
        <label v-for="code in VARIETY_CODES" :key="code" :class="OPTION">
          <Checkbox :model-value="model.dialects.includes(code)" @update:model-value="(v) => toggle('dialects', code, v)" />
          <span class="truncate" :title="varietyOptionLabel(code)">{{ varietyOptionLabel(code) }}</span>
        </label>
      </div>
      <p v-for="v in nested" :key="v.code" class="text-muted-foreground mt-1 text-xs">
        {{ t('{child}是{parent}的地方變體，勾「{parent}」時會一併出現。', { child: dialectLabel(v.code), parent: dialectLabel(v.parent ?? '') }) }}
      </p>
    </fieldset>

    <fieldset>
      <legend class="mb-2 font-medium">{{ t('語言單位') }}</legend>
      <div :class="GRID">
        <label v-for="u in UNIT_CODES" :key="u" :class="OPTION">
          <Checkbox :model-value="model.units.includes(u)" @update:model-value="(v) => toggle('units', u, v)" />
          <span>{{ unitLabel(u) }}</span>
        </label>
      </div>
    </fieldset>

    <Button v-if="hasFilters" variant="outline" class="w-full" @click="reset">{{ t('清除篩選') }}</Button>
  </div>
</template>
