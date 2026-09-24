<script setup>
/**
 * 搜尋結果：詞條（詞形、變體、詞根、其他寫法命中）。
 * 整列可點擊進入詞條頁；播放鈕與說明按鈕不會觸發導覽。
 */
import { computed } from 'vue'
import AudioButton from '@/components/common/AudioButton.vue'
import DialectBadge from '@/components/common/DialectBadge.vue'
import MatchExplanation from '@/components/common/MatchExplanation.vue'
import MatchTypeTag from '@/components/common/MatchTypeTag.vue'
import MetaTag from '@/components/common/MetaTag.vue'
import { t } from '@/i18n.js'
import { matchKindLabel, recordRoute, roleLabel, unitLabel } from '@/lib/labels.js'
import ResultCitation from './ResultCitation.vue'

const props = defineProps({
  /** search-core 的 EntryHit */
  hit: { type: Object, required: true },
  query: { type: String, default: '' },
})

const doc = computed(() => props.hit.doc)
const showUnit = computed(() => doc.value.unit !== 'word')
const contextLabel = computed(() => {
  const role = doc.value.role
  if (role === 'form' || role === 'example') {
    return t('hit.underEntry', { entry: doc.value.groupTitle, role: roleLabel(role) })
  }
  return ''
})
</script>

<template>
  <article class="hover:bg-muted/50 relative flex gap-3 rounded-lg px-3 py-3 transition-colors sm:px-4">
    <div class="min-w-0 flex-1 space-y-1">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 class="native-text text-lg leading-snug font-semibold">
          <RouterLink :to="recordRoute(doc.id)" class="after:absolute after:inset-0 hover:underline">
            {{ doc.text }}
          </RouterLink>
        </h3>
        <DialectBadge v-for="d in doc.dialects" :key="d" :dialect="d" />
        <MetaTag v-if="showUnit">{{ unitLabel(doc.unit) }}</MetaTag>
        <MetaTag v-if="hit.kind !== 'head'" variant="soft">
          {{ matchKindLabel(hit.kind) }} <span class="native-text font-medium">{{ hit.term }}</span>
        </MetaTag>
        <MatchTypeTag :match-type="hit.matchType" :term="hit.term" />
        <span v-if="hit.matchType === 'fuzzy' && hit.distance > 0" class="relative z-10">
          <MatchExplanation :distance="hit.distance" :alignment="hit.alignment" :query="query" :term="hit.term" />
        </span>
      </div>

      <p v-if="doc.zh || doc.en || doc.nan" class="gloss-zh text-[15px]">
        <span v-if="doc.zh">{{ doc.zh }}</span>
        <span v-if="doc.en" class="text-muted-foreground" :class="doc.zh && 'ml-2'">{{ doc.en }}</span>
        <span v-if="doc.nan" class="text-muted-foreground ml-2 text-sm">{{ t('gloss.nanPrefix') }}{{ doc.nan }}</span>
      </p>
      <p v-if="contextLabel" class="text-muted-foreground text-xs">{{ contextLabel }}</p>
      <ResultCitation :source="doc.source" :citation="doc.citation" :status="doc.status" />
    </div>
    <div v-if="doc.audio" class="relative z-10 shrink-0 self-center">
      <AudioButton :play-key="doc.id" :src="doc.audio" :label="doc.text" />
    </div>
  </article>
</template>
