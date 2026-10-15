<script setup lang="ts">
/**
 * 逐詞對譯（interlinear gloss）：每個詞形與其對譯上下對齊。
 * 以 flex-wrap 排列，窄螢幕自動換行而不會橫向溢出。
 */
import type { PropType } from 'vue'
import { t } from '@/i18n.ts'

defineProps({
  /** 標準記錄的 interlinear */
  pairs: { type: Array as PropType<Array<{ form: string; gloss: string }>>, required: true },
})
</script>

<template>
  <div class="flex flex-wrap gap-x-4 gap-y-3" role="table" :aria-label="t('逐詞對譯')">
    <div v-for="(pair, k) in pairs" :key="k" class="flex flex-col" role="row">
      <span class="native-text font-medium" role="cell">{{ pair.form || '—' }}</span>
      <span class="text-muted-foreground text-sm" role="cell">{{ pair.gloss || '—' }}</span>
    </div>
  </div>
</template>
