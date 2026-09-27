<script setup>
/**
 * 動態規劃表（ARIA grid，docs/lab-design.md 第 4 節）。
 * - 列 i：查詢字串前 i 個字元；欄 j：候選字串前 j 個字元；格內是 D(i, j)
 * - revealed：依計算順序已經算好的格數（逐步播放）；尚未計算的格子顯示「·」
 * - showPath：最佳路徑（主色實心）；focus：播放中的目前格；selected：使用者選取的格（兩者都是主色外框）
 * - 鍵盤：整張表只有一個 tab stop，方向鍵在格子間移動，Home／End 到列首尾，Ctrl＋Home／End 到表格兩角，
 *   Enter／Space 選取
 */
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { t } from '@/i18n.js'
import { formatDistance } from '@/lib/labels.js'
import { cn } from '@/lib/utils'

const props = defineProps({
  /** WeightedEditDistance.explain() 的結果 */
  explanation: { type: Object, required: true },
  revealed: { type: Number, default: Infinity },
  showPath: { type: Boolean, default: true },
  /** 播放中的目前格 {i, j} */
  focus: { type: Object, default: null },
  /** 選取的格 [i, j] */
  selected: { type: Array, default: null },
})
const emit = defineEmits(['select'])

const e = computed(() => props.explanation)
const table = useTemplateRef('table')

/** 每一格在計算順序中的位置 */
const orderIndex = computed(() => {
  const map = new Map()
  e.value.order.forEach(([i, j], k) => map.set(`${i},${j}`, k))
  return map
})
const onPath = computed(() => new Set(e.value.path.map(([i, j]) => `${i},${j}`)))
const maxValue = computed(() => Math.max(1, ...e.value.matrix.flat().filter(Number.isFinite)))

/** roving tabindex：目前可以 tab 進來的那一格 */
const active = ref(/** @type {[number, number]} */ ([0, 0]))
watch(
  () => props.selected ?? [e.value.query.length, e.value.candidate.length],
  (cell) => (active.value = [cell[0], cell[1]]),
  { immediate: true },
)

/** @param {number} i @param {number} j */
function isRevealed(i, j) {
  return orderIndex.value.get(`${i},${j}`) < props.revealed
}
/** @param {number} i @param {number} j */
const isPath = (i, j) => props.showPath && onPath.value.has(`${i},${j}`)
/** @param {number} i @param {number} j */
const isFocus = (i, j) => props.focus?.i === i && props.focus?.j === j
/** @param {number} i @param {number} j */
const isSelected = (i, j) => props.selected?.[0] === i && props.selected?.[1] === j

/** 格角的方向箭頭 @param {number} i @param {number} j */
function arrow(i, j) {
  const best = e.value.candidates[i][j][0]
  if (!best) return ''
  // 規則可能一次跨越多格，統一用 ⤡ 表示；來源格在右側說明中列出
  if (best.op === 'rule') return '⤡'
  return { match: '↖', substitute: '↖', delete: '↑', insert: '←' }[best.op] ?? ''
}

/** @param {number} i @param {number} j */
function cellClass(i, j) {
  const revealed = isRevealed(i, j)
  const path = isPath(i, j)
  const best = e.value.candidates[i][j][0]
  const ringed = isFocus(i, j) || isSelected(i, j)
  return cn(
    'lab-cell relative h-11 min-w-11 border text-center font-mono text-xs tabular-nums outline-none select-none',
    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset cursor-pointer',
    !revealed && 'text-muted-foreground/40',
    revealed && !path && best?.op === 'rule' && 'text-accent-foreground',
    path && 'bg-primary text-primary-foreground font-semibold',
    ringed && (path ? 'ring-primary-foreground ring-2 ring-inset' : 'ring-primary ring-2 ring-inset'),
  )
}

/** 以數值深淺表示成本（路徑格不套用） @param {number} i @param {number} j */
function cellStyle(i, j) {
  if (!isRevealed(i, j) || isPath(i, j)) return {}
  const v = e.value.matrix[i][j]
  const ratio = Math.min(1, v / maxValue.value)
  const rule = e.value.candidates[i][j][0]?.op === 'rule'
  return {
    backgroundColor: rule
      ? `color-mix(in oklch, var(--accent) ${40 + ratio * 30}%, transparent)`
      : `color-mix(in oklch, var(--muted-foreground) ${ratio * 22}%, transparent)`,
  }
}

/**
 * grid 內的鍵盤操作。
 * @param {KeyboardEvent} event
 * @param {number} i
 * @param {number} j
 */
function onKeydown(event, i, j) {
  const rows = e.value.query.length
  const cols = e.value.candidate.length
  /** @type {[number, number] | null} */
  let next = null
  if (event.key === 'ArrowUp') next = [Math.max(0, i - 1), j]
  else if (event.key === 'ArrowDown') next = [Math.min(rows, i + 1), j]
  else if (event.key === 'ArrowLeft') next = [i, Math.max(0, j - 1)]
  else if (event.key === 'ArrowRight') next = [i, Math.min(cols, j + 1)]
  else if (event.key === 'Home') next = event.ctrlKey ? [0, 0] : [i, 0]
  else if (event.key === 'End') next = event.ctrlKey ? [rows, cols] : [i, cols]
  else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('select', [i, j])
    return
  }
  if (!next) return
  event.preventDefault()
  active.value = next
  nextTick(() => table.value?.querySelector(`[data-cell="${next[0]},${next[1]}"]`)?.focus())
}
</script>

<template>
  <div class="scrollbar-thin w-fit max-w-full self-start overflow-x-auto rounded-lg border">
    <table ref="table" class="border-collapse" role="grid" :aria-label="t('動態規劃表')" :aria-rowcount="e.matrix.length + 1" :aria-colcount="e.candidate.length + 2">
      <thead>
        <tr role="row">
          <th class="bg-muted sticky left-0 z-10 h-11 min-w-11 border text-xs font-normal" role="columnheader">
            <span class="sr-only">{{ t('查詢＼候選') }}</span>
          </th>
          <th
            v-for="(ch, j) in ['', ...e.candidate]"
            :key="j"
            role="columnheader"
            class="bg-muted relative h-11 min-w-11 border px-1 text-sm font-medium"
            :title="e.finalColumns[j] ? t('詞尾位置：可套用詞尾規則') : undefined"
          >
            <span class="native-text">{{ ch === ' ' ? '␣' : ch || 'ε' }}</span>
            <span class="text-muted-foreground absolute right-1 bottom-0.5 text-[9px] font-normal">{{ j }}</span>
            <span v-if="e.finalColumns[j] && j > 0" class="bg-primary absolute top-1 right-1 size-1.5 rounded-full" aria-hidden="true" />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in e.matrix" :key="i" role="row">
          <th role="rowheader" class="bg-muted sticky left-0 z-10 h-11 min-w-11 border px-1 text-sm font-medium">
            <span class="native-text">{{ i === 0 ? 'ε' : e.query[i - 1] === ' ' ? '␣' : e.query[i - 1] }}</span>
            <span class="text-muted-foreground absolute bottom-0.5 left-1 text-[9px] font-normal">{{ i }}</span>
          </th>
          <td
            v-for="(value, j) in row"
            :key="j"
            role="gridcell"
            :data-cell="`${i},${j}`"
            :class="cellClass(i, j)"
            :style="cellStyle(i, j)"
            :tabindex="active[0] === i && active[1] === j ? 0 : -1"
            :aria-selected="isSelected(i, j)"
            :aria-label="`D(${i}, ${j}) = ${isRevealed(i, j) ? formatDistance(value) : t('尚未計算')}`"
            @click="((active = [i, j]), emit('select', [i, j]))"
            @keydown="onKeydown($event, i, j)"
          >
            <template v-if="isRevealed(i, j)">
              {{ formatDistance(value) }}
              <span class="absolute top-0 left-0.5 text-[9px] opacity-60" aria-hidden="true">{{ arrow(i, j) }}</span>
            </template>
            <template v-else>·</template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

