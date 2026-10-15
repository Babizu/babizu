<script setup lang="ts">
/**
 * 語詞索引（KWIC，key word in context）：每個命中區間一列，左文靠右、命中置中、右文靠左，
 * 對齊之後一眼看得出同一個句型前後接了什麼。可以依左邊或右邊緊鄰的詞排序（語料庫查詢工具的慣例）。
 * 窄螢幕（< sm）改成一般的一行文字，命中的部分加粗。
 */
import type { DocSummary } from '@babizu/search/index.ts'
import type { PatternHit } from '@babizu/pattern/index.ts'
import { computed, ref, type PropType } from 'vue'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n.ts'
import { formatCount, recordRoute } from '@/lib/labels.ts'
import { KWIC_SORTS } from '@/lib/pattern.ts'

const props = defineProps({
  /** 已依頻率表的篩選過濾 */
  hits: { type: Array as PropType<PatternHit[]>, required: true },
})
/** 排序方式（KWIC_SORTS 的 key） */
const sort = defineModel<string>('sort', { default: 'position' })

const STEP = 100
/** 左右各留多少字元（在詞的邊界截斷） */
const CONTEXT_CHARS = 48
const limit = ref(STEP)

const leftContext = (s: string) => {
  if (s.length <= CONTEXT_CHARS) return s
  const cut = s.slice(-CONTEXT_CHARS)
  const space = cut.indexOf(' ')
  return `…${space >= 0 ? cut.slice(space + 1) : cut}`
}
const rightContext = (s: string) => {
  if (s.length <= CONTEXT_CHARS) return s
  const cut = s.slice(0, CONTEXT_CHARS)
  const space = cut.lastIndexOf(' ')
  return `${space >= 0 ? cut.slice(0, space) : cut}…`
}

/** 語詞索引的一列 */
interface KwicLine {
  id: string
  doc: DocSummary
  left: string
  match: string
  right: string
  /** 排序鍵：左右緊鄰的詞、命中的詞 */
  keys: { left: string; right: string; match: string }
}

const lines = computed(() => {
  const out: KwicLine[] = []
  for (const h of props.hits) {
    for (const m of h.matches) {
      if (m.cond !== 0) continue
      const text = h.doc.text
      out.push({
        id: `${h.doc.id}:${m.start}`,
        doc: h.doc,
        left: leftContext(text.slice(0, m.start)),
        match: text.slice(m.start, m.end),
        right: rightContext(text.slice(m.end)),
        keys: { left: m.left[0] ?? '', right: m.right[0] ?? '', match: m.cells.map((c) => c.key).join(' ') },
      })
    }
  }
  if (sort.value === 'position') return out
  const k = sort.value as 'left' | 'right' | 'match'
  // 沒有鄰詞（在句首或句尾）的排在最後
  return [...out].sort((a, b) => Number(a.keys[k] === '') - Number(b.keys[k] === '') || a.keys[k].localeCompare(b.keys[k]) || a.keys.match.localeCompare(b.keys.match))
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
