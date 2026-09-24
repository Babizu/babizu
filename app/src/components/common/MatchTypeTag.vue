<script setup>
/**
 * 命中方式標籤：說明這筆為什麼會出現在結果裡。
 * 模糊命中另有 MatchExplanation 顯示距離與規則；詞條的構詞命中另有 MorphologyExplanation，
 * 這裡處理前綴、包含，以及例句的構詞命中（詞根相符、衍生形）。
 */
import { computed } from 'vue'
import { t } from '@/i18n.js'
import MetaTag from './MetaTag.vue'

const props = defineProps({
  /** fuzzy／prefix／lemma／derived／substring */
  matchType: { type: String, required: true },
  /** 命中的詞庫詞，供說明用 */
  term: { type: String, default: '' },
})

const info = computed(() =>
  ['prefix', 'substring', 'lemma', 'derived'].includes(props.matchType)
    ? { label: t(`matchType.${props.matchType}`), hint: t(`matchType.${props.matchType}Hint`) }
    : null,
)
</script>

<template>
  <MetaTag v-if="info" :title="info.hint">{{ info.label }}</MetaTag>
</template>
