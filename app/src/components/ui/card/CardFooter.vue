<!-- shadcn-vue new-york-v4 元件的 JavaScript 版（以 reka-ui 為基礎）。修改樣式時請保持與其他元件一致。 -->
<script setup>
import { cn } from '@/lib/utils'

const props = defineProps({ class: { type: null, default: undefined } })
const BASE_CLASS = "flex items-center px-6 [.border-t]:pt-6"
</script>

<template>
  <div data-slot="card-footer" :class="cn(BASE_CLASS, props.class)">
    <slot />
  </div>
</template>
