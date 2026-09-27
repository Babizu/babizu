<script setup>
/**
 * 語言變體（方言）徽章。顏色來自站台設定（每個變體一個 `.variety-<代碼>` class，見 src/site/vite.js），
 * 全站一致；從屬的變體用上層的色相、較低彩度。站台沒有定義的代碼用中性色。
 */
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { dialectLabel, site } from '@/lib/labels.js'

const props = defineProps({
  /** 變體代碼（站台設定 varieties 的 code） */
  dialect: { type: String, required: true },
  class: { type: null, default: undefined },
})

const known = computed(() => site.varieties.some((v) => v.code === props.dialect))
</script>

<template>
  <Badge size="tag" :variant="known ? 'variety' : 'muted'" :class="[known && `variety-${dialect}`, props.class]">
    {{ dialectLabel(dialect) }}
  </Badge>
</template>
