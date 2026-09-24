<script setup>
/**
 * 文字高亮。
 * - mode="native"：逐詞比對族語搜尋鍵（含構詞部分），命中的詞整個標記
 * - mode="plain"：比對子字串（中文、英文釋義），不分大小寫
 */
import { computed } from 'vue'
import { searchKey, tokenize } from '@/lib/text.js'

const props = defineProps({
  text: { type: String, default: '' },
  /** native 模式：要高亮的搜尋鍵 */
  terms: { type: Array, default: () => [] },
  /** plain 模式：要高亮的子字串 */
  needle: { type: String, default: '' },
  mode: { type: String, default: 'native' },
})

/** @typedef {{text: string, hit: boolean}} Piece */

const pieces = computed(() => {
  if (props.mode === 'plain') return splitPlain(props.text, props.needle.trim())
  return splitNative(props.text, new Set(/** @type {string[]} */ (props.terms)))
})

/**
 * 以空白與標點切詞（保留分隔字元），逐詞判斷是否命中。
 * @param {string} text
 * @param {Set<string>} terms
 * @returns {Piece[]}
 */
function splitNative(text, terms) {
  if (terms.size === 0) return [{ text, hit: false }]
  return text
    .split(/([\s,.;:!?"“”()[\]。，、；：！？「」]+)/u)
    .filter((part) => part !== '')
    .map((part) => {
      const key = searchKey(part)
      const hit = key !== '' && (terms.has(key) || tokenize(part).some((t) => terms.has(t)))
      return { text: part, hit }
    })
}

/**
 * @param {string} text
 * @param {string} needle
 * @returns {Piece[]}
 */
function splitPlain(text, needle) {
  if (!needle) return [{ text, hit: false }]
  const out = []
  const lower = text.toLowerCase()
  const n = needle.toLowerCase().replace(/\s+/gu, '')
  // 中文查詢忽略原文中的空白：逐字尋找
  let k = 0
  while (k < text.length) {
    const at = lower.indexOf(n, k)
    if (at < 0 || n === '') break
    if (at > k) out.push({ text: text.slice(k, at), hit: false })
    out.push({ text: text.slice(at, at + n.length), hit: true })
    k = at + n.length
  }
  if (k < text.length) out.push({ text: text.slice(k), hit: false })
  return out
}
</script>

<template>
  <span><template v-for="(piece, k) in pieces" :key="k"><mark v-if="piece.hit">{{ piece.text }}</mark><template v-else>{{ piece.text }}</template></template></span>
</template>
