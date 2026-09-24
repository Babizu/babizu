<script setup>
/**
 * 對齊結果：最佳路徑的每一步，上方是查詢片段、下方是候選片段，依操作類型上色。
 */
import { t } from '@/i18n.js'
import { categoryLabel, formatDistance, opLabel } from '@/lib/labels.js'

defineProps({
  /** explain().alignment */
  steps: { type: Array, required: true },
})

const OP_CLASSES = {
  match: 'bg-muted text-foreground',
  rule: 'bg-accent text-accent-foreground ring-1 ring-primary/30',
  substitute: 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100',
  delete: 'bg-rose-100 text-rose-950 dark:bg-rose-950 dark:text-rose-100',
  insert: 'bg-sky-100 text-sky-950 dark:bg-sky-950 dark:text-sky-100',
}
</script>

<template>
  <div>
    <ol class="flex flex-wrap gap-1.5" :aria-label="t('lab.alignment')">
      <li
        v-for="(step, k) in steps"
        :key="k"
        class="flex min-w-9 flex-col items-center rounded-md px-2 py-1"
        :class="OP_CLASSES[step.op]"
        :title="t('lab.stepTitle', { op: opLabel(step.op) + (step.rule?.category ? ` · ${categoryLabel(step.rule.category)}` : ''), cost: formatDistance(step.cost) })"
      >
        <span class="native-text font-mono text-sm leading-tight">{{ step.source || '∅' }}</span>
        <span class="native-text font-mono text-sm leading-tight">{{ step.target || '∅' }}</span>
        <span v-if="step.cost > 0" class="text-[10px] leading-tight tabular-nums opacity-70">+{{ formatDistance(step.cost) }}</span>
      </li>
    </ol>
    <ul class="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      <li v-for="(cls, op) in OP_CLASSES" :key="op" class="flex items-center gap-1.5">
        <span class="size-3 rounded-sm" :class="cls" aria-hidden="true" />{{ opLabel(op) }}
      </li>
    </ul>
  </div>
</template>
