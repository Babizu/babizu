<script setup>
/**
 * 檢查清單：例句中沒有辭典條目的一個詞。
 *
 * 左欄是這個詞與它出現的例句，右欄是辭典中最接近的詞條（與搜尋結果同一套標籤：
 * 模糊命中可以點開看對齊、構詞命中可以點開看拆解），以及依最接近的詞條猜的類別。
 * 兩欄並列，校對者一眼就能判斷它只是方言變體、沒被列出的加綴派生，還是真的缺條目。
 */
import { computed } from 'vue'
import DialectBadge from '@/components/common/DialectBadge.vue'
import HighlightText from '@/components/common/HighlightText.vue'
import MetaTag from '@/components/common/MetaTag.vue'
import HitTags from '@/components/search/HitTags.vue'
import { useSources } from '@/composables/useSources.js'
import { t } from '@/i18n.js'
import { formatCount, recordRoute } from '@/lib/labels.js'
import { vCardLink } from '@/lib/card-link.js'
import { TOKEN_KINDS } from './kinds.js'

const props = defineProps({
  /** Checklist.tokenPage 的一項 */
  item: { type: Object, required: true },
})

const { shortTitle } = useSources()
const kind = computed(() => TOKEN_KINDS.find((k) => k.value === props.item.kind) ?? TOKEN_KINDS[TOKEN_KINDS.length - 1])
const example = computed(() => props.item.examples[0] ?? null)
const searchRoute = computed(() => ({ name: 'search', query: { q: props.item.term } }))
</script>

<template>
  <li class="grid gap-x-8 gap-y-3 py-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
    <!-- 左：這個詞與它出現的例句 -->
    <div class="min-w-0">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 class="native-text text-xl leading-snug font-semibold">
          <RouterLink :to="searchRoute" class="hover:underline" :title="t('用這個詞搜尋')">{{ item.term }}</RouterLink>
        </h3>
        <span class="text-muted-foreground text-xs tabular-nums">{{ t('出現在 {count} 句', { count: formatCount(item.count) }) }}</span>
      </div>
      <p v-if="example" class="native-text text-muted-foreground mt-2 text-sm leading-relaxed">
        <RouterLink :to="recordRoute(example.id)" class="hover:text-foreground transition-colors">
          <HighlightText :text="example.text" :terms="[item.term]" />
        </RouterLink>
      </p>
      <p v-if="example?.zh || example?.en" class="gloss-zh text-muted-foreground mt-0.5 line-clamp-2 text-xs">
        {{ example.zh || example.en }}
      </p>
      <p v-if="item.count > 1" class="mt-2 text-xs">
        <RouterLink :to="searchRoute" class="text-primary hover:underline">
          {{ t('看全部 {count} 句', { count: formatCount(item.count) }) }} →
        </RouterLink>
      </p>
    </div>

    <!-- 右：辭典中最接近的詞條 -->
    <div class="min-w-0 lg:border-l lg:pl-8">
      <p class="mb-1.5 flex items-center gap-2">
        <MetaTag variant="soft" :title="t(kind.hint)">
          <span aria-hidden="true" class="font-mono">{{ kind.glyph }}</span>{{ t(kind.label) }}
        </MetaTag>
      </p>
      <p v-if="!item.hits.length" class="text-muted-foreground text-sm">{{ t('辭典中找不到拼寫相近的詞條，可能需要新增條目。') }}</p>
      <ul v-else class="-mx-2 space-y-0.5">
        <li v-for="hit in item.hits" :key="hit.doc.id" v-card-link="recordRoute(hit.doc.id)" class="group hover:bg-muted/60 relative rounded-md px-2 py-1.5 transition-colors">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RouterLink :to="recordRoute(hit.doc.id)" class="native-text font-medium group-hover:underline">
              {{ hit.doc.text }}
            </RouterLink>
            <DialectBadge v-for="d in hit.doc.dialects" :key="d" :dialect="d" />
            <HitTags :hit="hit" :query="item.term" />
          </div>
          <p class="text-muted-foreground mt-0.5 flex min-w-0 gap-2 text-xs">
            <span class="gloss-zh min-w-0 truncate">{{ hit.doc.zh || hit.doc.en }}</span>
            <span class="shrink-0">{{ shortTitle(hit.doc.source) }}</span>
          </p>
        </li>
      </ul>
    </div>
  </li>
</template>
