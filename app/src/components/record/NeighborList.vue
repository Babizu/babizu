<script setup>
/**
 * 跨來源相近詞：其他來源、其他方言中拼寫相近的詞條，附距離與規則說明。
 */
import DialectBadge from '@/components/common/DialectBadge.vue'
import MatchExplanation from '@/components/common/MatchExplanation.vue'
import { useSources } from '@/composables/useSources.js'
import { recordRoute } from '@/lib/labels.js'
import { t } from '@/i18n.js'

defineProps({
  /** search-core 的 EntryHit[] */
  hits: { type: Array, required: true },
  query: { type: String, required: true },
})

const { shortTitle } = useSources()
</script>

<template>
  <ul class="divide-y">
    <li v-for="hit in hits" :key="hit.doc.id" class="relative flex items-start gap-3 py-2.5">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <RouterLink :to="recordRoute(hit.doc.id)" class="native-text font-medium after:absolute after:inset-0 hover:underline">
            {{ hit.doc.text }}
          </RouterLink>
          <DialectBadge v-for="d in hit.doc.dialects" :key="d" :dialect="d" />
          <span class="relative z-10">
            <MatchExplanation
              v-if="hit.distance > 0"
              :distance="hit.distance"
              :alignment="hit.alignment"
              :query="query"
              :term="hit.term"
            />
            <span v-else class="text-muted-foreground text-[11px]">{{ t('neighbors.sameSpelling') }}</span>
          </span>
        </div>
        <p class="text-muted-foreground mt-0.5 truncate text-sm">
          {{ [hit.doc.zh, hit.doc.en].filter(Boolean).join(' ') }}
        </p>
        <p class="text-muted-foreground text-xs">{{ shortTitle(hit.doc.source) }}</p>
      </div>
    </li>
  </ul>
</template>
