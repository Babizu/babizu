<script setup>
/**
 * 資料來源總覽：每個來源的後設資料、收錄統計、說明與瀏覽入口。
 */
import { ArrowRightIcon } from '@lucide/vue'
import { computed } from 'vue'
import DialectBadge from '@/components/common/DialectBadge.vue'
import StateMessage from '@/components/common/StateMessage.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useSources } from '@/composables/useSources.js'
import { UNIT_CODES } from '@babizu/schema/constants.js'
import { t } from '@/i18n.js'
import { formatCount, shardUnitLabel, sourceTypeLabel, unitLabel } from '@/lib/labels.js'

const { sources, loaded, error } = useSources()
/** 統計的顯示順序：最常用的「詞」在前 */
const UNIT_KEYS = ['word', 'phrase', 'sentence', 'affix'].filter((u) => UNIT_CODES.includes(u))

/**
 * 全部來源的加總。讀者想先知道「這本辭典整體有多少東西」，再往下看各來源的細節，
 * 所以放在各來源卡片之前。
 */
const totals = computed(() => {
  /** @type {Record<string, number>} */
  const sum = { records: 0, word: 0, phrase: 0, sentence: 0, affix: 0, audio: 0, scans: 0 }
  for (const s of sources.value) {
    for (const key of Object.keys(sum)) sum[key] += s.stats?.[key] ?? 0
  }
  return sum
})

/** 總計要顯示的欄位，沒有資料的就不列 */
const TOTAL_ROWS = computed(() =>
  [
    { key: 'records', label: t('sources.records') },
    ...UNIT_KEYS.map((u) => ({ key: u, label: unitLabel(u) })),
    { key: 'audio', label: t('sources.audio') },
    { key: 'scans', label: t('sources.scans') },
  ].filter((row) => totals.value[row.key] > 0),
)
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
    <header class="mb-8 max-w-2xl">
      <h1 class="font-serif text-3xl font-bold tracking-tight">{{ t('nav.sources') }}</h1>
      <p class="text-muted-foreground mt-2">
        {{ t('sources.intro') }}
      </p>
    </header>

    <StateMessage v-if="error" tone="error" :title="t('sources.loadFailed')" :description="error" />

    <!-- 全部來源加總：先給整體規模，再進到各來源 -->
    <section v-else-if="loaded" class="border-border mb-8 border-y py-4" aria-labelledby="h-totals">
      <h2 id="h-totals" class="text-muted-foreground mb-3 text-xs font-medium tracking-wide">
        {{ t('sources.totals', { count: sources.length }) }}
      </h2>
      <dl class="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        <div v-for="row in TOTAL_ROWS" :key="row.key">
          <dt class="text-muted-foreground text-xs">{{ row.label }}</dt>
          <dd class="font-serif text-2xl font-bold tabular-nums">{{ formatCount(totals[row.key]) }}</dd>
        </div>
      </dl>
    </section>

    <div v-if="!error && !loaded" class="grid gap-4 md:grid-cols-2">
      <Skeleton v-for="k in 4" :key="k" class="h-64" />
    </div>

    <div v-else-if="loaded" class="grid gap-4 md:grid-cols-2">
      <Card v-for="s in sources" :key="s.id" class="gap-4">
        <CardHeader>
          <p class="text-muted-foreground text-xs">{{ sourceTypeLabel(s.type) }}</p>
          <CardTitle class="text-lg">{{ s.title }}</CardTitle>
          <CardDescription v-if="s.authors.length || s.year || s.publisher">
            {{ [s.authors.join(t('common.listSeparator')), s.publisher, s.year].filter(Boolean).join(' · ') }}
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-4 text-sm">
          <p v-if="s.description" class="leading-relaxed">{{ s.description }}</p>

          <!-- 點統計數字可以看該類別的完整清單 -->
          <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <RouterLink
              :to="{ name: 'source-list', params: { source: s.id } }"
              class="bg-muted/60 hover:bg-accent hover:text-accent-foreground block rounded-lg px-3 py-2 transition-colors"
            >
              <dt class="text-muted-foreground text-xs">{{ t('sources.records') }}</dt>
              <dd class="text-lg font-semibold tabular-nums">{{ formatCount(s.stats?.records ?? 0) }}</dd>
            </RouterLink>
            <RouterLink
              v-for="u in UNIT_KEYS.filter((k) => s.stats?.[k])"
              :key="u"
              :to="{ name: 'source-list', params: { source: s.id }, query: { unit: u } }"
              class="bg-muted/60 hover:bg-accent hover:text-accent-foreground block rounded-lg px-3 py-2 transition-colors"
            >
              <dt class="text-muted-foreground text-xs">{{ unitLabel(u) }}</dt>
              <dd class="text-lg font-semibold tabular-nums">{{ formatCount(s.stats[u]) }}</dd>
            </RouterLink>
            <div v-if="s.stats?.audio" class="bg-muted/60 rounded-lg px-3 py-2">
              <dt class="text-muted-foreground text-xs">{{ t('sources.audio') }}</dt>
              <dd class="text-lg font-semibold tabular-nums">{{ formatCount(s.stats.audio) }}</dd>
            </div>
          </dl>

          <div v-if="s.defaultDialects.length" class="flex items-center gap-2">
            <span class="text-muted-foreground text-xs">{{ t('filter.varieties') }}</span>
            <DialectBadge v-for="d in s.defaultDialects" :key="d" :dialect="d" />
          </div>
          <p v-if="s.orthography" class="text-muted-foreground text-xs">{{ t('sources.orthography', { value: s.orthography }) }}</p>
          <ul v-if="s.notes.length" class="text-muted-foreground list-disc space-y-1 pl-4 text-xs leading-relaxed">
            <li v-for="(note, k) in s.notes" :key="k">{{ note }}</li>
          </ul>
          <p v-if="s.citation" class="bg-muted/40 rounded-md p-3 text-xs leading-relaxed">
            <span class="text-muted-foreground">{{ t('sources.cite') }}</span>{{ s.citation }}
          </p>
        </CardContent>
        <CardFooter class="mt-auto">
          <Button as-child variant="outline" class="w-full sm:w-auto">
            <RouterLink :to="{ name: 'browse', params: { source: s.id } }">
              {{ t('sources.browse', { count: formatCount(s.shards.length), unit: shardUnitLabel(s) }) }}<ArrowRightIcon />
            </RouterLink>
          </Button>
        </CardFooter>
      </Card>
    </div>
  </div>
</template>
