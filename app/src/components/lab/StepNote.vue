<script setup lang="ts">
/**
 * 目前這一步的說明（一句話）。距離參數以 formatDistance 格式化（null 表示 ∞）。
 * 播放中不讓螢幕閱讀器逐步朗讀（aria-live 關閉），停下來時才念出目前這一步。
 */
import { DISTANCE_PARAMS, type Step } from '@/lab/steps.ts'
import { computed, type PropType } from 'vue'
import { t } from '@/i18n.ts'
import { formatDistance } from '@/lib/labels.ts'

const props = defineProps({
  /** app/src/lab/steps.ts 的一步；null 表示還沒開始 */
  step: { type: Object as PropType<Step | null>, default: null },
  playing: { type: Boolean, default: false },
  /** 還沒開始時顯示的說明 */
  idle: { type: String, default: '' },
})

const text = computed(() => {
  if (!props.step) return props.idle
  const params = Object.fromEntries(
    Object.entries(props.step.note.params).map(([k, v]) => [k, DISTANCE_PARAMS.has(k) ? formatDistance(v as number) : v ?? '∅']),
  )
  return t(props.step.note.key, params)
})
/** BCDP 套件文件的位置（proofRef 形如 bcdp.md#…） */
const DOCS = 'https://github.com/Babizu/babizu/blob/main/packages/bcdp/docs/'
const docHref = computed(() => (props.step?.proofRef ? `${DOCS}${props.step.proofRef}` : null))
</script>

<template>
  <p class="bg-card min-h-11 rounded-md border px-3 py-2.5 text-sm leading-relaxed" :aria-live="playing ? 'off' : 'polite'">
    <span>{{ text }}</span>
    <a v-if="docHref" :href="docHref" target="_blank" rel="noopener" class="text-primary ml-1.5 whitespace-nowrap underline-offset-2 hover:underline">
      {{ t('為什麼？') }}
    </a>
  </p>
</template>
