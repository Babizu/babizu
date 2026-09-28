<script setup>
/**
 * 命中方式標籤：說明這筆為什麼會出現在結果裡。
 * 模糊命中另有 MatchExplanation 顯示距離與規則；詞條的構詞命中另有 MorphologyExplanation，
 * 這裡處理開頭相符、包含，以及沒有附分析的構詞命中（自動拆解、自動派生）。
 */
import { computed } from 'vue'
import { MATCH_TYPES, matchTypeHint, matchTypeLabel } from '@/lib/labels.js'
import MetaTag from './MetaTag.vue'

const props = defineProps({
  /** fuzzy／prefix／lemma／derived／substring */
  matchType: { type: String, required: true },
  /** 命中的詞庫詞，供說明用 */
  term: { type: String, default: '' },
})

const info = computed(() => (props.matchType in MATCH_TYPES ? { label: matchTypeLabel(props.matchType), hint: matchTypeHint(props.matchType) } : null))
</script>

<template>
  <MetaTag v-if="info" :title="info.hint">{{ info.label }}</MetaTag>
</template>
