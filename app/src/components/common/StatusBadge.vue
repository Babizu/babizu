<script setup>
/**
 * 校對狀態徽章（三級）：未校對＝紅、初步校對＝黃、二審校對＝綠。
 * 顏色定義集中在這裡，全站一致。
 */
import { computed } from 'vue'
import { t } from '@/i18n.js'
import { QUALITY_STATUSES, statusLabel } from '@/lib/labels.js'
import { cn } from '@/lib/utils'

const props = defineProps({
  /** unreviewed／reviewed／verified */
  status: { type: String, required: true },
  /** dot：只顯示小圓點＋文字（結果列用）；badge：有底色的徽章（詞條頁用） */
  variant: { type: String, default: 'dot' },
  class: { type: null, default: undefined },
})

const info = computed(() => QUALITY_STATUSES[props.status] ?? null)

/**
 * 結果列每一行都會出現校對狀態，所以文字用次要色、只讓圓點帶顏色，
 * 避免整頁都是紅字或黃字。詞條頁用 badge 變體，顏色比較完整。
 */
const TONE_TEXT = {
  danger: 'text-muted-foreground',
  warning: 'text-muted-foreground',
  success: 'text-muted-foreground',
}
const TONE_DOT = {
  danger: 'bg-rose-500',
  warning: 'bg-amber-500',
  success: 'bg-emerald-500',
}
const TONE_BADGE = {
  danger: 'bg-rose-500/12 text-rose-700 dark:text-rose-300',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  success: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
}
</script>

<template>
  <span
    v-if="info"
    :class="
      cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap',
        variant === 'badge'
          ? ['h-5 rounded px-1.5 text-[11px] leading-none', TONE_BADGE[info.tone]]
          : ['text-xs', TONE_TEXT[info.tone]],
        props.class,
      )
    "
    :title="t('status.title', { label: statusLabel(status) })"
  >
    <span v-if="variant === 'dot'" :class="cn('size-1.5 rounded-full', TONE_DOT[info.tone])" aria-hidden="true" />
    {{ statusLabel(status) }}
  </span>
</template>
