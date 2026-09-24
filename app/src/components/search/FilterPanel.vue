<script setup>
/**
 * 搜尋篩選：搜尋範圍、模糊程度、來源、語言變體（方言）、語言單位。
 * 桌面放在側欄（窄），行動裝置放在底部抽屜（寬）——同一個元件。
 *
 * 版面依**容器**寬度而不是視窗寬度決定欄數（`@container` 加 `auto-fill`），
 * 所以同一份標記在 15rem 的側欄裡是一欄、在抽屜裡自動變成兩三欄，
 * 不必為兩個位置各寫一套。
 */
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { UNIT_CODES } from '@babizu/schema/constants.js'
import { useSources } from '@/composables/useSources.js'
import { t } from '@/i18n.js'
import { dialectLabel, orderedVarieties, site, unitLabel } from '@/lib/labels.js'

/**
 * @typedef {object} FilterState
 * @property {string[]} fields 搜尋範圍：native 族語、gloss 釋義（可複選）
 * @property {'exact' | 'normal' | 'loose'} fuzziness
 * @property {string[]} sources
 * @property {string[]} dialects
 * @property {string[]} units
 */

const model = defineModel({ type: Object, required: true })
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

const fuzzinessIndex = computed({
  get: () => [Math.max(0, FUZZINESS_STEPS.indexOf(model.value.fuzziness))],
  set: ([i]) => (model.value = { ...model.value, fuzziness: FUZZINESS_STEPS[i] }),
})
const fuzzinessLabel = computed(() => t(`fuzziness.${model.value.fuzziness ?? 'normal'}`))

/** @param {string} code */
const varietyOptionLabel = (code) => (code === 'none' ? t('filter.noVariety') : dialectLabel(code))

const hasFilters = computed(
  () => model.value.sources.length > 0 || model.value.dialects.length > 0 || model.value.units.length > 0,
)

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
  model.value = { ...model.value, sources: [], dialects: [], units: [] }
}
</script>

<template>
  <div class="@container space-y-6 text-sm">
    <fieldset>
      <legend class="mb-2 font-medium">{{ t('filter.fields') }}</legend>
      <div :class="GRID">
        <label v-for="f in FIELD_OPTIONS" :key="f" :class="OPTION" :title="t(`filter.field.${f}Hint`)">
          <Checkbox :model-value="model.fields.includes(f)" @update:model-value="(v) => toggle('fields', f, v)" />
          <span>{{ t(`filter.field.${f}`) }}</span>
        </label>
      </div>
      <p v-if="model.fields.length === 0" class="text-destructive mt-1 text-xs">{{ t('filter.fieldsRequired') }}</p>
    </fieldset>

    <section>
      <div class="mb-3 flex items-baseline justify-between">
        <h3 id="filter-fuzziness" class="font-medium">{{ t('filter.fuzziness') }}</h3>
        <span class="text-muted-foreground text-xs">{{ fuzzinessLabel }}</span>
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
:thumb-label="t('filter.fuzziness')"
          :thumb-value-text="fuzzinessLabel"
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
          {{ t(`fuzziness.${s}`) }}
        </button>
      </div>
      <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
        {{ t('filter.fuzzinessHint') }}
      </p>
    </section>

    <fieldset>
      <legend class="mb-2 font-medium">{{ t('filter.sources') }}</legend>
      <div :class="GRID_WIDE">
        <label v-for="s in sources" :key="s.id" :class="OPTION">
          <Checkbox :model-value="model.sources.includes(s.id)" @update:model-value="(v) => toggle('sources', s.id, v)" />
          <span class="truncate" :title="s.shortTitle">{{ s.shortTitle }}</span>
        </label>
      </div>
    </fieldset>

    <fieldset v-if="hasVarieties">
      <legend class="mb-2 font-medium">{{ t('filter.varieties') }}</legend>
      <div :class="GRID">
        <label v-for="code in VARIETY_CODES" :key="code" :class="OPTION">
          <Checkbox :model-value="model.dialects.includes(code)" @update:model-value="(v) => toggle('dialects', code, v)" />
          <span class="truncate" :title="varietyOptionLabel(code)">{{ varietyOptionLabel(code) }}</span>
        </label>
      </div>
      <p v-for="v in nested" :key="v.code" class="text-muted-foreground mt-1 text-xs">
        {{ t('filter.varietyNote', { child: dialectLabel(v.code), parent: dialectLabel(v.parent ?? '') }) }}
      </p>
    </fieldset>

    <fieldset>
      <legend class="mb-2 font-medium">{{ t('filter.units') }}</legend>
      <div :class="GRID">
        <label v-for="u in UNIT_CODES" :key="u" :class="OPTION">
          <Checkbox :model-value="model.units.includes(u)" @update:model-value="(v) => toggle('units', u, v)" />
          <span>{{ unitLabel(u) }}</span>
        </label>
      </div>
    </fieldset>

    <Button v-if="hasFilters" variant="outline" class="w-full" @click="reset">{{ t('filter.reset') }}</Button>
  </div>
</template>
