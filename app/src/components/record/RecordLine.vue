<script setup>
/**
 * 精簡的記錄列：用在詞條脈絡（同一詞條的派生詞與例句）與來源瀏覽頁。
 */
import { computed } from 'vue'
import AudioButton from '@/components/common/AudioButton.vue'
import DialectBadge from '@/components/common/DialectBadge.vue'
import MetaTag from '@/components/common/MetaTag.vue'
import { formatTimecode, recordRoute, roleLabel } from '@/lib/labels.js'
import { cn } from '@/lib/utils'

const props = defineProps({
  record: { type: Object, required: true },
  /** 縮排層級（0 = 詞條本身） */
  depth: { type: Number, default: 0 },
  active: { type: Boolean, default: false },
  showRole: { type: Boolean, default: true },
})

const audio = computed(() => props.record.media.find((/** @type {any} */ m) => m.type === 'audio' && m.available))
const gloss = computed(() =>
  props.record.senses
    .map((/** @type {any} */ s) => [s.zh, s.en].filter(Boolean).join(' '))
    .filter(Boolean)
    .join('；'),
)
const isHead = computed(() => props.record.group?.role === 'head')
const role = computed(() => props.record.group?.role)
</script>

<template>
  <div
    :id="record.id"
    :class="
      cn(
        'relative flex scroll-mt-32 items-start gap-3 rounded-md px-3 py-2 transition-colors',
        active ? 'bg-accent ring-primary/40 ring-1' : 'hover:bg-muted/60',
      )
    "
    :style="{ paddingLeft: `${0.75 + Math.min(depth, 4) * 1.25}rem` }"
  >
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <RouterLink
          :to="recordRoute(record.id)"
          :class="cn('native-text after:absolute after:inset-0 hover:underline', isHead ? 'text-base font-semibold' : 'font-medium')"
          :aria-current="active ? 'true' : undefined"
        >
          {{ record.text }}
        </RouterLink>
        <span v-if="gloss" class="gloss-zh text-muted-foreground text-sm">{{ gloss }}</span>
      </div>
      <div
        v-if="(showRole && role && !isHead && role !== 'item') || record.dialects.length || record.citation.timecode"
        class="mt-1 flex flex-wrap items-center gap-1.5"
      >
        <MetaTag v-if="showRole && role && !isHead && role !== 'item' && role !== 'segment'">{{ roleLabel(role) }}</MetaTag>
        <DialectBadge v-for="d in record.dialects" :key="d" :dialect="d" />
        <span v-if="record.citation.timecode" class="text-muted-foreground font-mono text-xs tabular-nums">
          {{ formatTimecode(record.citation.timecode.start) }}
        </span>
      </div>
    </div>
    <AudioButton
      v-if="audio"
      class="relative z-10 shrink-0"
      size="icon-sm"
      :play-key="record.id"
      :src="audio.src"
      :start="audio.start"
      :end="audio.end"
      :label="record.text"
    />
  </div>
</template>
