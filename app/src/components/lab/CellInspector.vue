<script setup>
/**
 * 單格說明：列出到達這一格的所有候選轉移，成本最低者即為這格的值。
 */
import { computed } from 'vue'
import { t } from '@/i18n.js'
import { categoryLabel, formatDistance, opLabel } from '@/lib/labels.js'
import { cn } from '@/lib/utils'

const props = defineProps({
  explanation: { type: Object, required: true },
  /** [i, j] */
  cell: { type: Array, required: true },
})

const i = computed(() => props.cell[0])
const j = computed(() => props.cell[1])
const value = computed(() => props.explanation.matrix[i.value][j.value])
const candidates = computed(() => props.explanation.candidates[i.value][j.value])
const xPrefix = computed(() => props.explanation.query.slice(0, i.value).join(''))
const yPrefix = computed(() => props.explanation.candidate.slice(0, j.value).join(''))

/** 候選轉移的文字說明 @param {any} c */
function describe(c) {
  const [fi, fj] = c.from
  const xs = props.explanation.query.slice(fi, i.value).join('')
  const ys = props.explanation.candidate.slice(fj, j.value).join('')
  switch (c.op) {
    case 'match':
      return t('lab.step.match', { x: xs })
    case 'substitute':
      return t('lab.step.substitute', { x: xs, y: ys })
    case 'delete':
      return t('lab.step.delete', { x: xs })
    case 'insert':
      return t('lab.step.insert', { y: ys })
    default:
      return t('lab.step.rule', { x: xs || '∅', y: ys || '∅' })
  }
}

/** 規則的附註：分類、適用位置、是否為自動補上的反向規則 @param {any} rule */
function ruleNote(rule) {
  const parts = [rule.category ? categoryLabel(rule.category) : t('op.rule')]
  if (rule.position === 'initial' || rule.position === 'final') parts.push(t(`lab.position.${rule.position}`))
  if (rule.reversed) parts.push(t('lab.reversed'))
  return parts.join(' · ')
}
</script>

<template>
  <div class="bg-card rounded-lg border p-4 text-sm">
    <p class="font-medium">
      D({{ i }}, {{ j }}) = <span class="font-mono tabular-nums">{{ formatDistance(value) }}</span>
    </p>
    <p class="text-muted-foreground mt-1 text-xs">
      {{ t('lab.cellMeaningBefore') }}<span class="native-text text-foreground">{{ xPrefix || 'ε' }}</span
      >{{ t('lab.cellMeaningMiddle') }}<span class="native-text text-foreground">{{ yPrefix || 'ε' }}</span
      >{{ t('lab.cellMeaningAfter') }}
    </p>

    <p v-if="candidates.length === 0" class="text-muted-foreground mt-3 text-xs">{{ t('lab.origin') }}</p>
    <ol v-else class="mt-3 space-y-1.5">
      <li
        v-for="(c, k) in candidates"
        :key="k"
        :class="
          cn(
            'flex items-start justify-between gap-3 rounded-md px-2 py-1.5',
            k === 0 ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
          )
        "
      >
        <div class="min-w-0">
          <p>
            <span class="font-medium">{{ opLabel(c.op) }}</span>
            <span class="ml-1.5">{{ describe(c) }}</span>
          </p>
          <p class="text-xs opacity-80">
            {{ t('lab.from', { cell: `D(${c.from[0]}, ${c.from[1]})` }) }}
            <template v-if="c.rule"> · {{ ruleNote(c.rule) }}</template>
          </p>
        </div>
        <span class="shrink-0 font-mono text-xs tabular-nums">
          +{{ formatDistance(c.stepCost) }} = {{ formatDistance(c.cost) }}
        </span>
      </li>
    </ol>
  </div>
</template>
