<script setup>
/**
 * 句型搜尋的一筆結果：原文中命中的詞依引擎回傳的位置高亮（不在介面重新切詞，位置一定對得上），
 * 下面每個有說明的詞一組標籤（與一般搜尋的例句同一套 HitTags：自動是虛線框、確定是實心底）。
 * `_` 與 `!x` 比到的詞用較淡的底色（只是填在空位上的詞），也不附標籤。
 * 整列可以點（v-card-link），文字可以拖曳反白、複製。
 */
import { computed } from 'vue'
import AudioButton from '@/components/common/AudioButton.vue'
import DialectBadge from '@/components/common/DialectBadge.vue'
import HitTags from '@/components/search/HitTags.vue'
import ResultCitation from '@/components/search/ResultCitation.vue'
import { recordRoute } from '@/lib/labels.js'
import { vCardLink } from '@/lib/card-link.js'

const props = defineProps({
  /** babizu/pattern 的 PatternHit */
  hit: { type: Object, required: true },
})

const doc = computed(() => props.hit.doc)

/**
 * 原文切成片段：命中的詞是 cells 的範圍（重疊的只取一次）。
 * hit：'word' 是句型中寫出條件的詞，'slot' 是 `_` 或 `!x` 比到的詞，null 是沒有命中
 */
const pieces = computed(() => {
  const text = /** @type {string} */ (doc.value.text)
  const ranges = props.hit.matches
    .flatMap((/** @type {any} */ m) => m.cells.map((/** @type {any} */ c) => ({ s: c.start, e: c.end, word: c.evidence !== null })))
    .sort((/** @type {any} */ a, /** @type {any} */ b) => a.s - b.s || a.e - b.e)
  /** @type {Array<{text: string, hit: 'word' | 'slot' | null}>} */
  const out = []
  let at = 0
  for (const r of ranges) {
    if (r.e <= at) continue
    const start = Math.max(r.s, at)
    if (start > at) out.push({ text: text.slice(at, start), hit: null })
    out.push({ text: text.slice(start, r.e), hit: r.word ? 'word' : 'slot' })
    at = r.e
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: null })
  return out
})

/** 有說明的詞：同一個詞、同一種說明只列一次；拼寫完全相同的不必說明（與一般搜尋相同） */
const tagged = computed(() => {
  /** @type {Map<string, any>} */
  const seen = new Map()
  for (const m of props.hit.matches) {
    for (const c of m.cells) {
      const e = c.evidence
      if (!e || (e.matchType === 'fuzzy' && e.distance === 0 && e.kind === 'token')) continue
      const key = `${c.key}\u0000${e.matchType}\u0000${e.kind}\u0000${e.term}`
      if (!seen.has(key)) seen.set(key, { token: c.key, evidence: e })
    }
  }
  return [...seen.values()]
})
</script>

<template>
  <article v-card-link="recordRoute(doc.id)" class="hover:bg-muted/50 relative flex gap-3 rounded-lg px-3 py-3 transition-colors sm:px-4">
    <div class="min-w-0 flex-1 space-y-1">
      <p class="native-text text-base leading-relaxed font-medium">
        <RouterLink :to="recordRoute(doc.id)">
          <template v-for="(p, k) in pieces" :key="k"><mark v-if="p.hit === 'word'">{{ p.text }}</mark><mark v-else-if="p.hit === 'slot'" class="bg-muted text-foreground">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template>
        </RouterLink>
      </p>
      <p v-if="doc.zh || doc.en" class="gloss-zh text-[15px]">
        <span v-if="doc.zh">{{ doc.zh }}</span>
        <span v-if="doc.en" class="text-muted-foreground" :class="doc.zh && 'ml-2'">{{ doc.en }}</span>
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <DialectBadge v-for="d in doc.dialects" :key="d" :dialect="d" />
        <span v-for="(x, k) in tagged" :key="k" class="inline-flex min-w-0 flex-wrap items-center gap-1.5">
          <!-- 詞條區的記錄只有一個詞（就是上面的詞條），不必再寫一次 -->
          <span v-if="hit.group !== 'entries' || tagged.length > 1" class="native-text text-muted-foreground text-xs">{{ x.token }}</span>
          <HitTags :hit="x.evidence" :query="x.evidence.word" />
        </span>
        <ResultCitation :source="doc.source" :citation="doc.citation" :status="doc.status" />
      </div>
    </div>
    <div v-if="doc.audio" class="relative z-10 shrink-0 self-center">
      <AudioButton :play-key="doc.id" :src="doc.audio" :label="doc.text" />
    </div>
  </article>
</template>
