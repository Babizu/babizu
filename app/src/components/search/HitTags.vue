<script setup>
/**
 * 命中的說明標籤：比對身分（變體、其他寫法…）、命中方式或構詞分析、模糊命中的距離。
 * 詞條結果列（EntryHitItem）、家族中的子項目（EntryRow）與例句（OccurrenceHitItem）共用，標籤才會一致。
 */
import MatchExplanation from '@/components/common/MatchExplanation.vue'
import MatchTypeTag from '@/components/common/MatchTypeTag.vue'
import MetaTag from '@/components/common/MetaTag.vue'
import MorphologyExplanation from '@/components/common/MorphologyExplanation.vue'
import { DICTIONARY_KINDS } from '@babizu/search/scoring.js'
import { matchKindHint, matchKindLabel } from '@/lib/labels.js'

defineProps({
  /** search-core 的 EntryHit，或例句的 OccurrenceMatch（kind 為 token 時不標身分） */
  hit: { type: Object, required: true },
  query: { type: String, default: '' },
  /**
   * 是否標出辭典的構詞關係（確定派生、拆解、同根）：家族中的子項目不需要，樹狀排列已經看得出關係
   */
  showRootKind: { type: Boolean, default: true },
})
</script>

<template>
  <MetaTag
    v-if="hit.kind && hit.kind !== 'head' && hit.kind !== 'token' && (showRootKind || !DICTIONARY_KINDS.has(hit.kind))"
    variant="soft"
    :title="matchKindHint(hit.kind) || undefined"
  >
    {{ matchKindLabel(hit.kind) }} <span class="native-text font-medium">{{ hit.kind === 'sibling' ? (hit.via ?? hit.term) : hit.term }}</span>
  </MetaTag>
  <span v-if="hit.analysis" class="relative z-10 inline-flex min-w-0">
    <MorphologyExplanation :analysis="hit.analysis" :match-type="hit.matchType" :query="query" :term="hit.term" />
  </span>
  <MatchTypeTag v-else :match-type="hit.matchType" :term="hit.term" />
  <span v-if="hit.matchType === 'fuzzy' && hit.distance > 0" class="relative z-10 inline-flex">
    <MatchExplanation :distance="hit.distance" :alignment="hit.alignment" :query="query" :term="hit.term" />
  </span>
</template>
