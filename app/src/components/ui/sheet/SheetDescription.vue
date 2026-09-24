<!-- shadcn-vue new-york-v4 元件的 JavaScript 版（以 reka-ui 為基礎）。修改樣式時請保持與其他元件一致。 -->
<script setup>
import { DialogDescription } from 'reka-ui'
import { cn } from '@/lib/utils'

defineOptions({ inheritAttrs: false })
const props = defineProps({ class: { type: null, default: undefined } })
const BASE_CLASS = "text-muted-foreground text-sm"
</script>

<template>
  <DialogDescription v-bind="$attrs" data-slot="sheet-description" :class="cn(BASE_CLASS, props.class)">
    <slot />
  </DialogDescription>
</template>
