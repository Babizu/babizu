<script setup>
/**
 * 語詞索引（KWIC，key word in context）：每個命中區間一列，左文靠右、命中置中、右文靠左，
 * 對齊之後一眼看得出同一個句型前後接了什麼。可以依左邊或右邊緊鄰的詞排序（語料庫查詢工具的慣例）。
 * 窄螢幕（< sm）改成一般的一行文字，命中的部分加粗。
 */
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n.js'
import { formatCount, recordRoute } from '@/lib/labels.js'
import { KWIC_SORTS } from '@/lib/pattern.js'

const props = defineProps({
  /** babizu/pattern 的 PatternHit[]（已依頻率表的篩選過濾） */
  hits: { type: Array, required: true },
})
/** 排序方式（KWIC_SORTS 的 key） */
const sort = defineModel('sort', { type: String, default: 'position' })

const STEP = 100
/** 左右各留多少字元（在詞的邊界截斷） */
const CONTEXT_CHARS = 48
const limit = ref(STEP)

/** @param {string} s */
const leftContext = (s) => {
  if (s.length <= CONTEXT_CHARS) return s
  const cut = s.slice(-CONTEXT_CHARS)
  const space = cut.indexOf(' ')
  return `…${space >= 0 ? cut.slice(space + 1) : cut}`
}
/** @param {string} s */
const rightContext = (s) => {
  if (s.length <= CONTEXT_CHARS) return s
  const cut = s.slice(0, CONTEXT_CHARS)
  const space = cut.lastIndexOf(' ')
  return `${space >= 0 ? cut.slice(0, space) : cut}…`
}

const lines = computed(() => {
  const out = []
  for (const h of /** @type {any[]} */ (props.hits)) {
    for (const m of h.matches) {
      if (m.cond !== 0) continue
      const text = /** @type {string} */ (h.doc.text)
      out.push({
        id: `${h.doc.id}:${m.start}`,
        doc: h.doc,
        left: leftContext(text.slice(0, m.start)),
        match: text.slice(m.start, m.end),
        right: rightContext(text.slice(m.end)),
        keys: { left: m.left[0] ?? '', right: m.right[0] ?? '', match: m.cells.map((/** @type {any} */ c) => c.key).join(' ') },
      })
    }
  }
  if (sort.value === 'position') return out
  const k = /** @type {'left' | 'right' | 'match'} */ (sort.value)
  // 沒有鄰詞（在句首或句尾）的排在最後
  return [...out].sort((a, b) => (a.keys[k] === '') - (b.keys[k] === '') || a.keys[k].localeCompare(b.keys[k]) || a.keys.match.localeCompare(b.keys.match))
})
</script>

<template>
  <div>
    <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" role="group" :aria-label="t('排序')">
      <span class="text-muted-foreground">{{ t('排序') }}</span>
      <button
        v-for="s in KWIC_SORTS"
        :key="s.key"
        type="button"
        class="min-h-8 rounded-md px-2 transition-colors"
        :class="sort === s.key ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted'"
        :aria-pressed="sort === s.key"
        @click="sort = s.key"
      >
        {{ t(s.label) }}
      </button>
    </div>
    <ol class="divide-border divide-y">
      <li v-for="line in lines.slice(0, limit)" :key="line.id">
        <RouterLink
          :to="recordRoute(line.doc.id)"
          class="native-text hover:bg-muted/60 block rounded-md px-2 py-1.5 transition-colors sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3"
        >
          <span class="text-muted-foreground sm:truncate sm:text-right" dir="ltr">{{ line.left }}</span>
          <span class="mx-1 font-semibold sm:mx-0"><mark>{{ line.match }}</mark></span>
          <span class="text-muted-foreground sm:truncate">{{ line.right }}</span>
        </RouterLink>
      </li>
    </ol>
    <div v-if="lines.length > limit" class="mt-4 flex justify-center">
      <Button variant="outline" @click="limit += STEP">{{ t('顯示更多（還有 {count} 筆）', { count: formatCount(lines.length - limit) }) }}</Button>
    </div>
  </div>
</template>
