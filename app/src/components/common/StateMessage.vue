<script setup>
/**
 * 空狀態、錯誤、提示的統一呈現。
 */
import { cn } from '@/lib/utils'

const props = defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  /** default／error */
  tone: { type: String, default: 'default' },
  class: { type: null, default: undefined },
})
</script>

<template>
  <div
    :class="
      cn(
        'flex flex-col items-center rounded-xl border border-dashed px-6 py-10 text-center',
        tone === 'error' && 'border-destructive/40 bg-destructive/5',
        props.class,
      )
    "
    :role="tone === 'error' ? 'alert' : undefined"
  >
    <div v-if="$slots.icon" class="text-muted-foreground mb-3 [&_svg]:size-8">
      <slot name="icon" />
    </div>
    <p class="font-medium" :class="tone === 'error' && 'text-destructive'">{{ title }}</p>
    <p v-if="description" class="text-muted-foreground mt-1 max-w-md text-sm">{{ description }}</p>
    <div v-if="$slots.default" class="mt-4">
      <slot />
    </div>
  </div>
</template>
