<!-- shadcn-vue new-york-v4 元件的 JavaScript 版（以 reka-ui 為基礎）。修改樣式時請保持與其他元件一致。 -->
<script setup>
import { TabsList } from 'reka-ui'
import { cn } from '@/lib/utils'

defineOptions({ inheritAttrs: false })
const props = defineProps({ class: { type: null, default: undefined } })
const BASE_CLASS = "bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]"
</script>

<template>
  <TabsList v-bind="$attrs" data-slot="tabs-list" :class="cn(BASE_CLASS, props.class)">
    <slot />
  </TabsList>
</template>
