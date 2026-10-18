<script setup lang="ts">
/**
 * 展示版的建置進度（頁面載入時在 Web Worker 裡建置網站資料；見 playground/builder.ts）。
 * 建置失敗時說明原因，並提供回到工作台修正的連結。
 */
import { HammerIcon, TriangleAlertIcon } from '@lucide/vue'
import { computed } from 'vue'
import { msg, t } from '@/i18n.ts'
import { buildState } from '@/playground/builder.ts'

const STEPS = { dataset: msg('整理詞表'), index: msg('建立搜尋索引'), derivations: msg('分析構詞（自動派生）'), done: msg('完成') } as const
const label = computed(() => {
  const step = buildState.value.step
  return step in STEPS ? t(STEPS[step as keyof typeof STEPS]) : ''
})
</script>

<template>
  <div
    v-if="buildState.step !== 'idle'"
    role="status"
    aria-live="polite"
    class="bg-background fixed inset-x-4 bottom-24 z-40 mx-auto max-w-md rounded-xl border p-4 shadow-lg md:bottom-6"
  >
    <template v-if="buildState.step === 'error'">
      <p class="flex items-center gap-2 font-medium">
        <TriangleAlertIcon class="text-destructive size-4 shrink-0" aria-hidden="true" />
        {{ t('建置失敗') }}
      </p>
      <p class="text-muted-foreground mt-1 text-xs break-words">{{ buildState.message }}</p>
      <RouterLink :to="{ name: 'studio' }" class="text-primary mt-2 inline-block text-sm underline underline-offset-4">{{ t('到工作台修正') }}</RouterLink>
    </template>
    <template v-else>
      <p class="flex items-center gap-2 font-medium">
        <HammerIcon class="size-4 shrink-0 animate-pulse" aria-hidden="true" />
        {{ t('正在建置辭典…') }}
      </p>
      <p class="text-muted-foreground mt-1 text-sm">
        {{ label }}<template v-if="buildState.step === 'derivations' && buildState.total">（{{ buildState.done }}／{{ buildState.total }}）</template>
      </p>
      <div v-if="buildState.step === 'derivations' && buildState.total" class="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
        <div class="bg-primary h-full transition-[width]" :style="{ width: `${(100 * buildState.done) / buildState.total}%` }" />
      </div>
    </template>
  </div>
</template>
