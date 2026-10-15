<script setup lang="ts">
/**
 * 搜尋結果一區（詞條、例句或釋義）的前 limit 筆。「全部」分頁的預覽與各區的完整列表共用。
 */
import type { EntryGroup, GlossHit, OccurrenceHit } from '@babizu/search/index.ts'
import { computed, type PropType } from 'vue'
import EntryGroupItem from './EntryGroupItem.vue'
import GlossHitItem from './GlossHitItem.vue'
import OccurrenceHitItem from './OccurrenceHitItem.vue'

/** 結果的一區：key 決定項目的種類 */
export type ResultSection =
  | { key: 'entries'; label: string; items: EntryGroup[]; total: number; field: 'native' }
  | { key: 'occurrences'; label: string; items: OccurrenceHit[]; total: number; field: 'native' }
  | { key: 'glosses'; label: string; items: GlossHit[]; total: number; field: 'gloss' }

const props = defineProps({
  section: { type: Object as PropType<ResultSection>, required: true },
  limit: { type: Number, required: true },
  query: { type: String, default: '' },
})

const section = computed(() => props.section)
</script>

<template>
  <template v-if="section.key === 'entries'">
    <EntryGroupItem v-for="group in section.items.slice(0, limit)" :key="group.root.doc.id" :group="group" :query="query" />
  </template>
  <template v-else-if="section.key === 'occurrences'">
    <OccurrenceHitItem v-for="hit in section.items.slice(0, limit)" :key="hit.doc.id" :hit="hit" />
  </template>
  <template v-else>
    <GlossHitItem v-for="hit in section.items.slice(0, limit)" :key="hit.doc.id" :hit="hit" :query="query" />
  </template>
</template>
