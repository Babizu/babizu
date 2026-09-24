<script setup>
/**
 * 原書掃描頁檢視器：可縮放、可捲動；觸控裝置可用兩指縮放按鈕或直接捲動。
 */
import { ExternalLinkIcon, MinusIcon, PlusIcon, ScanIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { dataUrl } from '@/services/data.js'
import { t } from '@/i18n.js'

const props = defineProps({
  /** 相對資料根目錄的掃描圖路徑 */
  scan: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
})
const open = defineModel('open', { type: Boolean, default: false })

/** 縮放倍率：1 = 符合容器寬度 */
const zoom = ref(1)
const ZOOM_STEPS = [1, 1.5, 2, 3]
const url = computed(() => dataUrl(props.scan))
const loaded = ref(false)

watch(open, (isOpen) => {
  if (isOpen) {
    zoom.value = 1
    loaded.value = false
  }
})

/** @param {1 | -1} direction */
function step(direction) {
  const k = ZOOM_STEPS.indexOf(zoom.value)
  zoom.value = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, k + direction))]
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex h-[92dvh] max-w-[calc(100%-1rem)] flex-col gap-3 p-3 sm:max-w-4xl sm:p-4">
      <DialogHeader class="pr-8 text-left">
        <DialogTitle class="text-base">{{ title }}</DialogTitle>
        <DialogDescription v-if="description">{{ description }}</DialogDescription>
      </DialogHeader>
      <div class="bg-muted relative min-h-0 flex-1 overflow-auto rounded-md border">
        <div v-if="!loaded" class="text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-sm">
          <ScanIcon class="size-4 animate-pulse" /> {{ t('scan.loading') }}
        </div>
        <img
          :src="url"
          :alt="title"
          class="mx-auto block max-w-none transition-[width] duration-150"
          :style="{ width: `${zoom * 100}%` }"
          @load="loaded = true"
        />
      </div>
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1">
          <Button variant="outline" size="icon" :disabled="zoom === ZOOM_STEPS[0]" :aria-label="t('scan.zoomOut')" @click="step(-1)">
            <MinusIcon />
          </Button>
          <span class="text-muted-foreground w-12 text-center text-sm tabular-nums">{{ Math.round(zoom * 100) }}%</span>
          <Button variant="outline" size="icon" :disabled="zoom === ZOOM_STEPS.at(-1)" :aria-label="t('scan.zoomIn')" @click="step(1)">
            <PlusIcon />
          </Button>
        </div>
        <Button variant="ghost" as="a" :href="url" target="_blank" rel="noopener">
          <ExternalLinkIcon /> {{ t('scan.openInNewTab') }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
