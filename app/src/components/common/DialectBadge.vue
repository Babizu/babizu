<script setup>
/**
 * 語言變體（方言）徽章。顏色來自站台設定（每個變體一個 `.variety-<代碼>` class，見 src/site/vite.js），
 * 全站一致；從屬的變體用上層的色相、較低彩度。站台沒有定義的代碼用中性色。
 */
import { computed } from 'vue'
import { dialectLabel, site } from '@/lib/labels.js'
import { cn } from '@/lib/utils'

const props = defineProps({
  /** 變體代碼（站台設定 varieties 的 code） */
  dialect: { type: String, required: true },
  class: { type: null, default: undefined },
})

const known = computed(() => site.varieties.some((v) => v.code === props.dialect))
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-[11px] leading-none font-medium whitespace-nowrap',
        known ? `variety-${dialect} bg-[var(--variety-bg)] text-[var(--variety-fg)]` : 'bg-muted text-muted-foreground',
        props.class,
      )
    "
  >
    {{ dialectLabel(dialect) }}
  </span>
</template>
