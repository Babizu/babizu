<script setup>
/**
 * 低調的屬性標籤（單位、角色、比對身分等）：shadcn 的 Badge（size tag），與方言徽章同高，讓一行內的標籤對齊。
 */
import { Badge } from '@/components/ui/badge'

const props = defineProps({
  class: { type: null, default: undefined },
  /** outline：外框；soft：淺底 */
  variant: { type: String, default: 'outline' },
})
</script>

<template>
  <Badge size="tag" :variant="variant === 'outline' ? 'quiet' : 'soft'" :class="props.class">
    <slot />
  </Badge>
</template>
