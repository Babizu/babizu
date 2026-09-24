<script setup>
/**
 * 命中方式標籤：說明這筆為什麼會出現在結果裡。
 * 模糊命中另有 MatchExplanation 顯示距離與規則，這裡只處理前綴與包含。
 */
import { computed } from 'vue'
import { t } from '@/i18n.js'
import MetaTag from './MetaTag.vue'

const props = defineProps({
  /** fuzzy／prefix／substring */
  matchType: { type: String, required: true },
  /** 命中的詞庫詞，供說明用 */
  term: { type: String, default: '' },
})

const info = computed(() =>
  props.matchType === 'prefix' || props.matchType === 'substring'
    ? { label: t(`matchType.${props.matchType}`), hint: t(`matchType.${props.matchType}Hint`) }
    : null,
)
</script>

<template>
  <MetaTag v-if="info" :title="info.hint">{{ info.label }}</MetaTag>
</template>
