<!-- shadcn-vue new-york-v4 元件的 JavaScript 版（以 reka-ui 為基礎）。修改樣式時請保持與其他元件一致。 -->
<script setup>
import { cn } from '@/lib/utils'

const props = defineProps({ class: { type: null, default: undefined } })
const BASE_CLASS = "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6"
</script>

<template>
  <div data-slot="card" :class="cn(BASE_CLASS, props.class)">
    <slot />
  </div>
</template>
