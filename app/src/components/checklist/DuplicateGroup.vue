<script setup>
/**
 * 檢查清單：詞形完全相同的一組詞條（或句子完全相同的一組例句），放在一起比對。
 *
 * 每一筆一列：出處在左、釋義在右，縱向對齊，一眼看得出哪幾筆的釋義一樣。
 * 同一個來源內釋義也相同的列標「釋義相同」：那是最可能重複登錄的地方。
 */
import { computed } from 'vue'
import DialectBadge from '@/components/common/DialectBadge.vue'
import MetaTag from '@/components/common/MetaTag.vue'
import { useSources } from '@/composables/useSources.js'
import { t } from '@/i18n.js'
import { formatCount, recordRoute } from '@/lib/labels.js'

const props = defineProps({
  /** Checklist.duplicatePage／sentencePage 的一組 */
  group: { type: Object, required: true },
  /** word：詞條（標題用大號詞形，比的是釋義）；sentence：例句（標題是整句，比的是翻譯） */
  kind: { type: String, default: 'word' },
})

const { shortTitle } = useSources()

/** 同一個來源內釋義也相同的記錄（沒有釋義的不算） */
const repeated = computed(() => {
  /** @type {Map<string, number>} */
  const seen = new Map()
  const key = (/** @type {any} */ d) => (d.zh || d.en ? `${d.source}\u0000${d.zh}\u0000${d.en}` : '')
  for (const d of props.group.docs) if (key(d)) seen.set(key(d), (seen.get(key(d)) ?? 0) + 1)
  return new Set(props.group.docs.filter((/** @type {any} */ d) => (seen.get(key(d)) ?? 0) > 1).map((/** @type {any} */ d) => d.id))
})
</script>

<template>
  <li class="py-5">
    <div class="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3 class="native-text leading-snug font-semibold" :class="kind === 'sentence' ? 'text-base' : 'text-xl'">
        <RouterLink :to="{ name: 'search', query: { q: group.text } }" class="hover:underline" :title="kind === 'sentence' ? t('用這一句搜尋') : t('用這個詞搜尋')">
          {{ group.text }}
        </RouterLink>
      </h3>
      <span class="text-muted-foreground text-xs tabular-nums">
        {{ t('{count} 筆 · {sources} 個來源', { count: formatCount(group.docs.length), sources: group.sources }) }}
      </span>
      <MetaTag v-if="group.repeated" variant="soft">{{ t('疑似重複登錄') }}</MetaTag>
    </div>
    <ul class="-mx-2">
      <li
        v-for="doc in group.docs"
        :key="doc.id"
        class="hover:bg-muted/60 relative grid gap-x-6 gap-y-0.5 rounded-md px-2 py-1.5 transition-colors sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
      >
        <p class="text-muted-foreground min-w-0 text-xs sm:pt-0.5">
          <RouterLink :to="recordRoute(doc.id)" class="after:absolute after:inset-0 hover:underline">
            <span class="text-foreground/80 font-medium">{{ shortTitle(doc.source) }}</span>
            <span aria-hidden="true"> · </span>
            <span class="break-words">{{ doc.citation }}</span>
          </RouterLink>
        </p>
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span v-if="doc.zh || doc.en" class="gloss-zh min-w-0 text-sm">
            {{ doc.zh }}<span v-if="doc.en" class="text-muted-foreground" :class="doc.zh && 'ml-2'">{{ doc.en }}</span>
          </span>
          <span v-else class="text-muted-foreground text-sm">{{ kind === 'sentence' ? t('（沒有翻譯）') : t('（沒有釋義）') }}</span>
          <DialectBadge v-for="d in doc.dialects" :key="d" :dialect="d" />
          <MetaTag v-if="repeated.has(doc.id) && kind === 'sentence'" :title="t('同一個來源內，另一筆的翻譯也完全相同')">{{ t('翻譯相同') }}</MetaTag>
          <MetaTag v-else-if="repeated.has(doc.id)" :title="t('同一個來源內，另一筆的釋義也完全相同')">{{ t('釋義相同') }}</MetaTag>
        </div>
      </li>
    </ul>
  </li>
</template>
