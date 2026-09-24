<script setup>
/**
 * 搜尋結果：查詢詞出現在其中的例句或語料句，命中的詞以高亮標示。
 */
import { computed } from 'vue'
import AudioButton from '@/components/common/AudioButton.vue'
import DialectBadge from '@/components/common/DialectBadge.vue'
import HighlightText from '@/components/common/HighlightText.vue'
import MatchTypeTag from '@/components/common/MatchTypeTag.vue'
import { recordRoute } from '@/lib/labels.js'
import ResultCitation from './ResultCitation.vue'

const props = defineProps({
  /** search-core 的 OccurrenceHit */
  hit: { type: Object, required: true },
})

const doc = computed(() => props.hit.doc)
</script>

<template>
  <article class="hover:bg-muted/50 relative flex gap-3 rounded-lg px-3 py-3 transition-colors sm:px-4">
    <div class="min-w-0 flex-1 space-y-1">
      <p class="native-text text-base leading-relaxed font-medium">
        <RouterLink :to="recordRoute(doc.id)" class="after:absolute after:inset-0">
          <HighlightText :text="doc.text" :terms="hit.terms" />
        </RouterLink>
      </p>
      <p v-if="doc.zh || doc.en" class="gloss-zh text-[15px]">
        <span v-if="doc.zh">{{ doc.zh }}</span>
        <span v-if="doc.en" class="text-muted-foreground" :class="doc.zh && 'ml-2'">{{ doc.en }}</span>
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <DialectBadge v-for="d in doc.dialects" :key="d" :dialect="d" />
        <MatchTypeTag :match-type="hit.matchType" />
        <ResultCitation :source="doc.source" :citation="doc.citation" :status="doc.status" />
      </div>
    </div>
    <div v-if="doc.audio" class="relative z-10 shrink-0 self-center">
      <AudioButton :play-key="doc.id" :src="doc.audio" :label="doc.text" />
    </div>
  </article>
</template>
