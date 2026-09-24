<script setup>
/**
 * 動態規劃表。
 * - 列 i：查詢字串前 i 個字元；欄 j：候選字串前 j 個字元；格內是 D(i, j)
 * - 最佳路徑上的格子以主色標示；格角的箭頭表示這格的值從哪裡來
 * - revealed：逐格動畫時已計算的格數（依 order 順序），尚未計算的格子顯示「·」
 */
import { computed } from 'vue'
import { t } from '@/i18n.js'
import { formatDistance } from '@/lib/labels.js'
import { cn } from '@/lib/utils'

const props = defineProps({
  /** WeightedEditDistance.explain() 的結果 */
  explanation: { type: Object, required: true },
  revealed: { type: Number, default: Infinity },
  selected: { type: Array, default: null },
})
const emit = defineEmits(['select'])

const e = computed(() => props.explanation)
/** 每一格在計算順序中的位置 */
const orderIndex = computed(() => {
  const map = new Map()
  e.value.order.forEach(([i, j], k) => map.set(`${i},${j}`, k))
  return map
})
const onPath = computed(() => new Set(e.value.path.map(([i, j]) => `${i},${j}`)))
const maxValue = computed(() => Math.max(1, ...e.value.matrix.flat().filter(Number.isFinite)))

/** @param {number} i @param {number} j */
function isRevealed(i, j) {
  return orderIndex.value.get(`${i},${j}`) < props.revealed
}

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
  const key = `${i},${j}`
  const revealed = isRevealed(i, j)
  const path = onPath.value.has(key) && props.revealed >= e.value.order.length
  const selected = props.selected && props.selected[0] === i && props.selected[1] === j
  const best = e.value.candidates[i][j][0]
  return cn(
    'relative h-11 min-w-11 border text-center font-mono text-xs tabular-nums transition-colors outline-none select-none',
    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset cursor-pointer',
    !revealed && 'text-muted-foreground/40',
    revealed && !path && best?.op === 'rule' && 'text-accent-foreground',
    path && 'bg-primary text-primary-foreground font-semibold',
    selected && 'ring-2 ring-inset ring-amber-500',
  )
}

/** 以數值深淺表示成本（路徑格不套用） @param {number} i @param {number} j */
function cellStyle(i, j) {
  if (!isRevealed(i, j) || (onPath.value.has(`${i},${j}`) && props.revealed >= e.value.order.length)) return {}
  const v = e.value.matrix[i][j]
  const ratio = Math.min(1, v / maxValue.value)
  const rule = e.value.candidates[i][j][0]?.op === 'rule'
  return {
    backgroundColor: rule
      ? `color-mix(in oklch, var(--accent) ${40 + ratio * 30}%, transparent)`
      : `color-mix(in oklch, var(--muted-foreground) ${ratio * 22}%, transparent)`,
  }
}
</script>

<template>
  <div class="scrollbar-thin w-fit max-w-full self-start overflow-x-auto rounded-lg border">
    <table class="border-collapse" :aria-label="t('lab.matrix')">
      <thead>
        <tr>
          <th class="bg-muted sticky left-0 z-10 h-11 min-w-11 border text-xs font-normal" scope="col">
            <span class="sr-only">{{ t('lab.matrixCorner') }}</span>
          </th>
          <th
            v-for="(ch, j) in ['', ...e.candidate]"
            :key="j"
            scope="col"
            class="bg-muted relative h-11 min-w-11 border px-1 text-sm font-medium"
            :title="e.finalColumns[j] ? t('lab.finalColumn') : undefined"
          >
            <span class="native-text">{{ ch === ' ' ? '␣' : ch || 'ε' }}</span>
            <span class="text-muted-foreground absolute right-1 bottom-0.5 text-[9px] font-normal">{{ j }}</span>
            <span v-if="e.finalColumns[j] && j > 0" class="bg-primary absolute top-1 right-1 size-1.5 rounded-full" aria-hidden="true" />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in e.matrix" :key="i">
          <th scope="row" class="bg-muted sticky left-0 z-10 h-11 min-w-11 border px-1 text-sm font-medium">
            <span class="native-text">{{ i === 0 ? 'ε' : e.query[i - 1] === ' ' ? '␣' : e.query[i - 1] }}</span>
            <span class="text-muted-foreground absolute bottom-0.5 left-1 text-[9px] font-normal">{{ i }}</span>
          </th>
          <td
            v-for="(value, j) in row"
            :key="j"
            :class="cellClass(i, j)"
            :style="cellStyle(i, j)"
            tabindex="0"
            :aria-label="`D(${i}, ${j}) = ${isRevealed(i, j) ? formatDistance(value) : t('lab.notComputed')}`"
            @click="emit('select', [i, j])"
            @keydown.enter.prevent="emit('select', [i, j])"
            @keydown.space.prevent="emit('select', [i, j])"
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
