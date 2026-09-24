<script setup>
/**
 * 播放按鈕。所有按鈕共用 useAudioPlayer 的單一播放器，按下另一個會停止前一個。
 */
import { LoaderCircleIcon, PauseIcon, PlayIcon, TriangleAlertIcon } from '@lucide/vue'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { useAudioPlayer } from '@/composables/useAudioPlayer.js'
import { t } from '@/i18n.js'
import { cn } from '@/lib/utils'

const props = defineProps({
  /** 播放器用來辨識按鈕的鍵，通常是記錄 id */
  playKey: { type: String, required: true },
  /** 相對資料根目錄的音檔路徑 */
  src: { type: String, required: true },
  start: { type: Number, default: null },
  end: { type: Number, default: null },
  /** 無障礙標籤，例如要播放的文字 */
  label: { type: String, default: '' },
  size: { type: String, default: 'icon' },
  class: { type: null, default: undefined },
})

const player = useAudioPlayer()
const active = computed(() => player.currentKey.value === props.playKey)
const state = computed(() => (active.value ? player.state.value : 'idle'))
const ariaLabel = computed(() => {
  const playing = state.value === 'playing'
  if (props.label) return t(playing ? 'audio.stopLabel' : 'audio.playLabel', { label: props.label })
  return t(playing ? 'audio.stop' : 'audio.play')
})

function onClick(/** @type {MouseEvent} */ event) {
  // 按鈕常放在可點擊的結果列中，避免同時觸發導覽
  event.preventDefault()
  event.stopPropagation()
  player.toggle(props.playKey, props.src, { start: props.start, end: props.end })
}
</script>

<template>
  <Button
    type="button"
    variant="outline"
    :size="size"
    :class="
      cn(
        'rounded-full',
        state === 'playing' && 'border-primary text-primary',
        state === 'error' && 'border-destructive text-destructive',
        props.class,
      )
    "
    :aria-label="ariaLabel"
    :aria-pressed="state === 'playing'"
    :title="state === 'error' ? t('audio.error') : undefined"
    @click="onClick"
  >
    <LoaderCircleIcon v-if="state === 'loading'" class="animate-spin" />
    <PauseIcon v-else-if="state === 'playing'" />
    <TriangleAlertIcon v-else-if="state === 'error'" />
    <PlayIcon v-else class="translate-x-px" />
  </Button>
</template>
