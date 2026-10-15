<script setup lang="ts">
/**
 * 搜尋結果：中文、英文或臺語釋義相符。
 */
import type { GlossHit } from '@babizu/search/index.ts'
import { computed, type PropType } from 'vue'
import AudioButton from '@/components/common/AudioButton.vue'
import DialectBadge from '@/components/common/DialectBadge.vue'
import HighlightText from '@/components/common/HighlightText.vue'
import MetaTag from '@/components/common/MetaTag.vue'
import { t } from '@/i18n.ts'
import { recordRoute, unitLabel } from '@/lib/labels.ts'
import { vCardLink } from '@/lib/card-link.ts'
import ResultCitation from './ResultCitation.vue'

const props = defineProps({
  hit: { type: Object as PropType<GlossHit>, required: true },
  query: { type: String, default: '' },
})

const doc = computed(() => props.hit.doc)
const isSentence = computed(() => doc.value.unit === 'sentence')
</script>

<template>
  <article v-card-link="recordRoute(doc.id)" class="group hover:bg-muted/50 relative flex gap-3 rounded-lg px-3 py-3 transition-colors sm:px-4">
    <div class="min-w-0 flex-1 space-y-1">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 class="native-text leading-snug font-semibold" :class="isSentence ? 'text-base' : 'text-lg'">
          <RouterLink :to="recordRoute(doc.id)" class="group-hover:underline">
            {{ doc.text }}
          </RouterLink>
        </h3>
        <DialectBadge v-for="d in doc.dialects" :key="d" :dialect="d" />
        <MetaTag v-if="doc.unit !== 'word'">{{ unitLabel(doc.unit) }}</MetaTag>
      </div>
      <p class="gloss-zh text-[15px]">
        <HighlightText v-if="doc.zh" mode="plain" :text="doc.zh" :needle="hit.field === 'zh' ? query : ''" />
        <span v-if="doc.en" class="text-muted-foreground" :class="doc.zh && 'ml-2'">
          <HighlightText mode="plain" :text="doc.en" :needle="hit.field === 'en' ? query : ''" />
        </span>
        <span v-if="doc.nan" class="text-muted-foreground ml-2 text-sm">
          {{ t('臺：') }}<HighlightText mode="plain" :text="doc.nan" :needle="hit.field === 'nan' ? query : ''" />
        </span>
      </p>
      <ResultCitation :source="doc.source" :citation="doc.citation" :status="doc.status" />
    </div>
    <div v-if="doc.audio" class="relative z-10 shrink-0 self-center">
      <AudioButton :play-key="doc.id" :src="doc.audio" :label="doc.text" />
    </div>
  </article>
</template>
