<script setup>
/**
 * 結果列底部的出處行：來源簡稱＋出處說明＋校對狀態。
 */
import StatusBadge from '@/components/common/StatusBadge.vue'
import { useSources } from '@/composables/useSources.js'

defineProps({
  source: { type: String, required: true },
  citation: { type: String, default: '' },
  status: { type: String, default: '' },
})

const { shortTitle, tracksReview } = useSources()
</script>

<template>
  <p class="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs">
    <span class="text-foreground/80 font-medium">{{ shortTitle(source) }}</span>
    <span aria-hidden="true">·</span>
    <span class="min-w-0 break-words">{{ citation }}</span>
    <StatusBadge v-if="status && tracksReview(source)" :status="status" />
  </p>
</template>
