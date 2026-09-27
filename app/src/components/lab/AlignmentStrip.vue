<script setup>
/**
 * 對齊結果：最佳路徑的每一步，上方是查詢片段、下方是候選片段。
 * 操作類型以符號為主、顏色為輔（docs/lab-design.md 第 2 節），色盲或黑白列印也能分辨。
 */
import { t } from '@/i18n.js'
import { categoryLabel, formatDistance, opLabel } from '@/lib/labels.js'

defineProps({
  /** explain().alignment */
  steps: { type: Array, required: true },
  /** 不顯示圖例（同一頁有多條對齊時只顯示一次） */
  compact: { type: Boolean, default: false },
})

/** 各操作的符號與底色（語意 token） */
const OPS = {
  match: { symbol: '＝', cls: 'border bg-card text-foreground' },
  rule: { symbol: '≈', cls: 'bg-accent text-accent-foreground' },
  substitute: { symbol: '≠', cls: 'bg-op-substitute text-op-substitute-foreground' },
  delete: { symbol: '−', cls: 'bg-op-delete text-op-delete-foreground' },
  insert: { symbol: '＋', cls: 'bg-op-insert text-op-insert-foreground' },
}
</script>

<template>
  <div>
    <ol class="flex flex-wrap gap-1.5" :aria-label="t('對齊結果')">
      <li
        v-for="(step, k) in steps"
        :key="k"
        class="relative flex min-w-9 flex-col items-center rounded-md px-2 pt-2.5 pb-1"
        :class="OPS[step.op].cls"
        :title="t('{op}，成本 {cost}', { op: opLabel(step.op) + (step.rule?.category ? ` · ${categoryLabel(step.rule.category)}` : ''), cost: formatDistance(step.cost) })"
      >
        <span class="absolute top-0 left-1 text-[10px] leading-tight opacity-70" aria-hidden="true">{{ OPS[step.op].symbol }}</span>
        <span class="sr-only">{{ opLabel(step.op) }}</span>
        <span class="native-text font-mono text-sm leading-tight">{{ step.source || '∅' }}</span>
        <span class="native-text font-mono text-sm leading-tight">{{ step.target || '∅' }}</span>
        <span v-if="step.cost > 0" class="text-[10px] leading-tight tabular-nums opacity-70">+{{ formatDistance(step.cost) }}</span>
      </li>
    </ol>
    <ul v-if="!compact" class="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      <li v-for="(o, op) in OPS" :key="op" class="flex items-center gap-1.5">
        <span class="flex size-4 items-center justify-center rounded-sm text-[10px]" :class="o.cls" aria-hidden="true">{{ o.symbol }}</span>{{ opLabel(op) }}
      </li>
    </ul>
  </div>
</template>
