<script setup>
/**
 * 頻率：主條件每一格比到的詞形與次數（例如 `_ ki _` 的第一格是哪些動詞）。
 * 每一格一張表；點一個詞形，句子與語詞索引只留下這一格是這個詞形的命中（再點一次取消）。
 * 次數是所有命中區間（不只畫面上這幾筆），「句」是有幾筆記錄。
 * 只有一種詞形的格（例如寫出的固定詞）不必一張表，在上面一行列出。
 */
import { computed } from 'vue'
import { t } from '@/i18n.js'
import { formatCount } from '@/lib/labels.js'

const props = defineProps({
  /** PatternResponse.frequency */
  frequency: { type: Array, required: true },
  /** PatternResponse.slots */
  slots: { type: Array, required: true },
})
/** 選取的詞形 {slot, form}；null 是不篩選 */
const selected = defineModel({ type: Object, default: null })

/** @param {number} slot @param {string} form */
const toggle = (slot, form) => {
  selected.value = selected.value?.slot === slot && selected.value?.form === form ? null : { slot, form }
}
/** @param {any} f */
const maxOf = (f) => Math.max(1, ...f.rows.map((/** @type {any} */ r) => r.count))
const fixed = computed(() => props.frequency.filter((/** @type {any} */ f) => f.distinct === 1))
const varied = computed(() => props.frequency.filter((/** @type {any} */ f) => f.distinct > 1))
</script>

<template>
  <p v-if="fixed.length" class="text-muted-foreground mb-6 flex flex-wrap gap-x-4 gap-y-1 text-sm">
    <span v-for="f in fixed" :key="f.slot">
      <span class="font-mono">{{ props.slots[f.slot].label }}</span>
      {{ t('都是') }} <span class="native-text text-foreground">{{ f.rows[0].form || t('（沒有詞）') }}</span>
    </span>
  </p>
  <p v-if="varied.length === 0" class="text-muted-foreground text-sm">{{ t('每一格都只有一種詞形。') }}</p>
  <div class="grid gap-x-8 gap-y-8 md:grid-cols-2">
    <section v-for="f in varied" :key="f.slot" :aria-labelledby="`freq-${f.slot}`">
      <h3 :id="`freq-${f.slot}`" class="mb-2 flex items-baseline justify-between gap-3 border-b pb-2">
        <span class="font-mono text-sm">{{ props.slots[f.slot].label }}</span>
        <span class="text-muted-foreground text-xs tabular-nums">{{ t('{distinct} 種，共 {total} 次', { distinct: formatCount(f.distinct), total: formatCount(f.total) }) }}</span>
      </h3>
      <ol>
        <li v-for="row in f.rows" :key="row.form">
          <button
            type="button"
            class="hover:bg-muted/60 grid min-h-9 w-full grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-3 rounded-md px-2 text-left transition-colors"
            :class="selected?.slot === f.slot && selected?.form === row.form && 'bg-accent text-accent-foreground'"
            :aria-pressed="selected?.slot === f.slot && selected?.form === row.form"
            @click="toggle(f.slot, row.form)"
          >
            <span class="flex min-w-0 flex-col gap-1">
              <span class="native-text truncate" :class="row.form === '' && 'text-muted-foreground italic'">{{ row.form || t('（沒有詞）') }}</span>
              <!-- 次數的長條：只是輔助，不加底色軌道 -->
              <span class="bg-primary/35 block h-0.5 rounded-full" :style="{ width: `${(row.count / maxOf(f)) * 100}%` }" aria-hidden="true" />
            </span>
            <span class="text-right text-sm tabular-nums">{{ formatCount(row.count) }}</span>
            <span class="text-muted-foreground text-right text-xs tabular-nums">{{ t('{count} 句', { count: formatCount(row.docs) }) }}</span>
          </button>
        </li>
      </ol>
      <p v-if="f.distinct > f.rows.length" class="text-muted-foreground mt-2 text-xs">
        {{ t('只列出最常見的 {count} 種。', { count: formatCount(f.rows.length) }) }}
      </p>
    </section>
  </div>
</template>
