<script setup>
/**
 * 搜尋結果：詞條（詞形、變體、詞根、其他寫法命中）。
 * 整列可點擊進入詞條頁；播放鈕與說明按鈕不會觸發導覽。
 *
 * 也用在詞條家族的第一列（EntryGroupItem）：家族的代表記錄本身不一定命中（hit 為 null），
 * 這時只顯示詞條內容，並標明它是底下命中項目所屬的詞條。
 */
import { computed } from 'vue'
import AudioButton from '@/components/common/AudioButton.vue'
import DialectBadge from '@/components/common/DialectBadge.vue'
import MetaTag from '@/components/common/MetaTag.vue'
import { t } from '@/i18n.js'
import { recordRoute, roleLabel, unitLabel } from '@/lib/labels.js'
import HitTags from './HitTags.vue'
import ResultCitation from './ResultCitation.vue'

const props = defineProps({
  /** search-core 的 EntryHit；null 表示這筆記錄本身沒有命中 */
  hit: { type: Object, default: null },
  /** 記錄摘要（DocSummary）；沒給就用 hit.doc */
  doc: { type: Object, default: null },
  query: { type: String, default: '' },
})

const doc = computed(() => props.doc ?? props.hit.doc)
const showUnit = computed(() => doc.value.unit !== 'word')
const contextLabel = computed(() => {
  const role = doc.value.role
  if (role === 'form' || role === 'example') {
    return t('{entry} 條下{role}', { entry: doc.value.groupTitle, role: roleLabel(role) })
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
        <HitTags v-if="hit" :hit="hit" :query="query" />
        <MetaTag v-else :title="t('這個詞條本身與查詢不相符，列出來是因為底下有相符的詞形')">{{ t('所屬詞條') }}</MetaTag>
      </div>

      <p v-if="doc.zh || doc.en || doc.nan" class="gloss-zh text-[15px]">
        <span v-if="doc.zh">{{ doc.zh }}</span>
        <span v-if="doc.en" class="text-muted-foreground" :class="doc.zh && 'ml-2'">{{ doc.en }}</span>
        <span v-if="doc.nan" class="text-muted-foreground ml-2 text-sm">{{ t('臺：') }}{{ doc.nan }}</span>
      </p>
      <p v-if="contextLabel" class="text-muted-foreground text-xs">{{ contextLabel }}</p>
      <ResultCitation :source="doc.source" :citation="doc.citation" :status="doc.status" />
    </div>
    <div v-if="doc.audio" class="relative z-10 shrink-0 self-center">
      <AudioButton :play-key="doc.id" :src="doc.audio" :label="doc.text" />
    </div>
  </article>
</template>
