<!-- shadcn-vue new-york-v4 元件的 JavaScript 版（以 reka-ui 為基礎）。修改樣式時請保持與其他元件一致。 -->
<script setup>
import { ToggleGroupRoot } from 'reka-ui'
import { provide } from 'vue'
import { cn } from '@/lib/utils'

defineOptions({ inheritAttrs: false })
const props = defineProps({
  class: { type: null, default: undefined },
  variant: { type: String, default: 'default' },
  size: { type: String, default: 'default' },
})
provide('toggleGroup', { variant: props.variant, size: props.size })
</script>

<template>
  <ToggleGroupRoot
    v-bind="$attrs"
    data-slot="toggle-group"
    :data-variant="variant"
    :data-size="size"
    :class="cn('group/toggle-group flex w-fit items-center rounded-md', props.class)"
  >
    <slot />
  </ToggleGroupRoot>
</template>
