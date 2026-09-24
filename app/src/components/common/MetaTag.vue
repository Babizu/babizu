<script setup>
/**
 * 低調的屬性標籤（單位、角色、比對身分等），與方言徽章同高，讓一行內的標籤對齊。
 */
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: null, default: undefined },
  /** outline：外框；soft：淺底 */
  variant: { type: String, default: 'outline' },
})
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] leading-none whitespace-nowrap',
        variant === 'outline' ? 'text-muted-foreground border' : 'bg-accent text-accent-foreground',
        props.class,
      )
    "
  >
    <slot />
  </span>
</template>
