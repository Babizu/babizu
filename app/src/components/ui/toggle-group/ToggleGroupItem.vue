<!-- shadcn-vue new-york-v4 元件的 JavaScript 版（以 reka-ui 為基礎）。修改樣式時請保持與其他元件一致。 -->
<script setup>
import { ToggleGroupItem } from 'reka-ui'
import { inject } from 'vue'
import { cn } from '@/lib/utils'
import { toggleVariants } from '.'

defineOptions({ inheritAttrs: false })
const props = defineProps({ class: { type: null, default: undefined } })
const context = inject('toggleGroup', { variant: 'default', size: 'default' })
</script>

<template>
  <ToggleGroupItem
    v-bind="$attrs"
    data-slot="toggle-group-item"
    :data-variant="context.variant"
    :data-size="context.size"
    :class="
      cn(
        toggleVariants({ variant: context.variant, size: context.size }),
        'min-w-0 flex-1 shrink-0 rounded-none shadow-none first:rounded-l-md last:rounded-r-md focus:z-10 focus-visible:z-10 data-[variant=outline]:border-l-0 data-[variant=outline]:first:border-l',
        props.class,
      )
    "
  >
    <slot />
  </ToggleGroupItem>
</template>
