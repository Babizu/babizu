<script setup>
/**
 * 播放控制（三個分頁共用，docs/lab-design.md 第 4 節）：重來、上一步、播放／暫停、下一步、結尾、進度拖曳、速度。
 * 狀態來自 usePlayback；鍵盤操作由頁面把 playback.onKeydown 掛在分頁容器上。
 */
import { ChevronFirstIcon, ChevronLastIcon, PauseIcon, PlayIcon, StepBackIcon, StepForwardIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { SPEEDS } from '@/composables/usePlayback.js'
import { t } from '@/i18n.js'

const props = defineProps({
  /** usePlayback() 的回傳值 */
  playback: { type: Object, required: true },
  /** 步數 */
  total: { type: Number, required: true },
})

const BUTTON = 'pointer-coarse:size-11'
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2" role="group" :aria-label="t('逐步播放')">
    <div class="flex items-center gap-1">
      <Button variant="outline" size="icon-sm" :class="BUTTON" :disabled="playback.atStart.value" :aria-label="t('回到開頭')" :title="t('回到開頭')" @click="playback.first">
        <ChevronFirstIcon />
      </Button>
      <Button variant="outline" size="icon-sm" :class="BUTTON" :disabled="playback.atStart.value" :aria-label="t('上一步')" :title="t('上一步')" @click="playback.prev">
        <StepBackIcon />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        :class="BUTTON"
        :aria-label="playback.playing.value ? t('暫停') : t('播放')"
        :aria-pressed="playback.playing.value"
        :title="playback.playing.value ? t('暫停') : t('播放')"
        @click="playback.toggle"
      >
        <PauseIcon v-if="playback.playing.value" />
        <PlayIcon v-else />
      </Button>
      <Button variant="outline" size="icon-sm" :class="BUTTON" :disabled="playback.atEnd.value" :aria-label="t('下一步')" :title="t('下一步')" @click="playback.next">
        <StepForwardIcon />
      </Button>
      <Button variant="outline" size="icon-sm" :class="BUTTON" :disabled="playback.atEnd.value" :aria-label="t('跳到結尾')" :title="t('跳到結尾')" @click="playback.last">
        <ChevronLastIcon />
      </Button>
    </div>
    <Slider
      class="min-w-32 flex-1 pointer-coarse:py-3"
      :model-value="[playback.index.value + 1]"
      :min="0"
      :max="Math.max(1, total)"
      :step="1"
      :thumb-label="t('步驟')"
      :thumb-value-text="t('第 {step} 步，共 {total} 步', { step: playback.index.value + 1, total })"
      @update:model-value="(v) => playback.seek(v[0] - 1)"
    />
    <span class="text-muted-foreground font-mono text-xs tabular-nums" aria-hidden="true">{{ playback.index.value + 1 }} / {{ total }}</span>
    <label class="text-muted-foreground flex items-center gap-1.5 text-xs">
      {{ t('速度') }}
      <select v-model.number="playback.speed.value" class="border-input bg-background h-8 rounded-md border px-1 text-xs pointer-coarse:h-11">
        <option v-for="s in SPEEDS" :key="s" :value="s">{{ s }}×</option>
      </select>
    </label>
  </div>
</template>
