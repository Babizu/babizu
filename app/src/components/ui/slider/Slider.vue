<!-- shadcn-vue new-york-v4 元件的 JavaScript 版（以 reka-ui 為基礎）。修改樣式時請保持與其他元件一致。 -->
<script setup>
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'
import { cn } from '@/lib/utils'

defineOptions({ inheritAttrs: false })
const props = defineProps({
  class: { type: null, default: undefined },
  /**
   * 滑鈕的無障礙名稱與讀值。
   * 放在 SliderRoot 上的 aria-* 不會傳到滑鈕，而帶 role="slider" 的是滑鈕，
   * 所以需要另外指定，否則螢幕閱讀器只會念出數字（「1」而不是「標準」）。
   */
  thumbLabel: { type: String, default: undefined },
  thumbValueText: { type: String, default: undefined },
})
const model = defineModel({ type: Array, default: () => [0] })
</script>

<template>
  <SliderRoot
    v-bind="$attrs"
    v-model="model"
    data-slot="slider"
    :class="
      cn(
        'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
        props.class,
      )
    "
  >
    <SliderTrack
      data-slot="slider-track"
      class="bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
    >
      <SliderRange
        data-slot="slider-range"
        class="bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
      />
    </SliderTrack>
    <SliderThumb
      v-for="(_, k) in model"
      :key="k"
      data-slot="slider-thumb"
      :aria-label="thumbLabel"
      :aria-valuetext="thumbValueText"
      class="border-primary bg-background ring-ring/50 block size-5 shrink-0 rounded-full border transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
    />
  </SliderRoot>
</template>
