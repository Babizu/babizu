<!-- shadcn-vue new-york-v4 元件的 JavaScript 版（以 reka-ui 為基礎）。修改樣式時請保持與其他元件一致。 -->
<script setup lang="ts">
import { Primitive } from 'reka-ui'
import type { PropType } from 'vue'
import { cn } from '@/lib/utils'
import { buttonVariants, type ButtonVariants } from '.'

const props = defineProps({
  variant: { type: String as PropType<ButtonVariants['variant']>, default: undefined },
  size: { type: String as PropType<ButtonVariants['size']>, default: undefined },
  class: { type: null, default: undefined },
  as: { type: [String, Object], default: 'button' },
  asChild: { type: Boolean, default: false },
})
</script>

<template>
  <Primitive
    data-slot="button"
    :as="as"
    :as-child="asChild"
    :class="cn(buttonVariants({ variant, size }), props.class)"
  >
    <slot />
  </Primitive>
</template>
