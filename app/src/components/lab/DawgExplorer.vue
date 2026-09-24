<script setup>
/**
 * 詞圖（DAWG）模糊搜尋視覺化：以一小組詞建立詞圖，顯示搜尋時每個節點的
 * 距離下界、允許上界、是否剪枝，以及因祖先被剪枝而從未走訪的節點。
 *
 * 注意：DAWG 會合併共同後綴，所以同一個節點可能出現在清單的好幾個位置
 * （例如 -an 結尾的詞共用同一個節點）。走訪是依「路徑」進行的，因此仍然正確。
 */
import { FuzzyIndex } from '@babizu/fuzzy/index.js'
import { computed, ref } from 'vue'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { t } from '@/i18n.js'
import { formatDistance, site } from '@/lib/labels.js'
import { cn } from '@/lib/utils'

const props = defineProps({
  /** 目前設定的 WeightedEditDistance */
  metric: { type: Object, required: true },
})

/** 預設詞庫與查詢來自站台設定（lab.words，否則用 lab.pairs 裡的詞）；都沒有就用一組示意用的拉丁字母詞 */
const DEFAULT_WORDS =
  site.lab.words ??
  ([...new Set(site.lab.pairs.flat())].join(' ') || 'kalan kalang talan palan pala kilan kulan salan')
const wordsText = ref(DEFAULT_WORDS)
const query = ref(site.lab.pairs[0]?.[0] ?? DEFAULT_WORDS.split(/\s+/u)[0] ?? '')
const maxDistance = ref([0.5])

const words = computed(() => [...new Set(wordsText.value.split(/[\s,，、]+/u).filter(Boolean))].slice(0, 200))

const run = computed(() => {
  const index = new FuzzyIndex(props.metric).addAll(words.value)
  /** @type {Map<string, import('@babizu/fuzzy/fuzzy-index.js').NodeVisit>} */
  const visits = new Map()
  const { results, stats } = index.searchWithStats(query.value, {
    maxDistance: maxDistance.value[0],
    onNode: (event) => visits.set(event.prefix, event),
  })

  // 依路徑攤平整個詞圖（依字元排序），標上走訪結果
  const dawg = index.dawg
  /** @type {Array<{prefix: string, label: string, depth: number, node: number, terminal: boolean, visit: any}>} */
  const rows = []
  /** @param {number} node @param {string} prefix @param {number} depth */
  const walk = (node, prefix, depth) => {
    for (let e = dawg.firstEdge(node); e < dawg.endEdge(node); e++) {
      const label = dawg.label(e)
      const target = dawg.target(e)
      const p = prefix + label
      rows.push({ prefix: p, label, depth, node: target, terminal: dawg.isFinal(target), visit: visits.get(p) ?? null })
      walk(target, p, depth + 1)
    }
  }
  walk(dawg.root, '', 0)
  return { results, stats, rows, nodeCount: dawg.nodeCount - 1, edgeCount: dawg.edgeCount }
})
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
    <div class="space-y-5 text-sm">
      <div>
        <label for="dawg-query" class="mb-1.5 block font-medium">{{ t('lab.query') }}</label>
        <Input id="dawg-query" v-model="query" class="native-text h-10" autocapitalize="off" autocorrect="off" spellcheck="false" />
      </div>
      <div>
        <div class="mb-2 flex justify-between">
          <label id="dawg-max" class="font-medium">{{ t('lab.maxDistance') }}</label>
          <span class="font-mono tabular-nums">{{ formatDistance(maxDistance[0]) }}</span>
        </div>
        <Slider v-model="maxDistance" :min="0" :max="3" :step="0.1" aria-labelledby="dawg-max" />
      </div>
      <div>
        <label for="dawg-words" class="mb-1.5 block font-medium">{{ t('lab.words') }}</label>
        <textarea
          id="dawg-words"
          v-model="wordsText"
          rows="6"
          class="border-input bg-background focus-visible:ring-ring/50 native-text w-full rounded-md border p-2 font-mono text-sm outline-none focus-visible:ring-[3px]"
          spellcheck="false"
        />
      </div>

      <dl class="grid grid-cols-3 gap-2 text-center">
        <div class="bg-muted/60 rounded-lg px-2 py-2">
          <dt class="text-muted-foreground text-xs">{{ t('lab.visited') }}</dt>
          <dd class="font-semibold tabular-nums">{{ run.stats.visitedNodes - 1 }}</dd>
        </div>
        <div class="bg-muted/60 rounded-lg px-2 py-2">
          <dt class="text-muted-foreground text-xs">{{ t('lab.pruned') }}</dt>
          <dd class="font-semibold tabular-nums">{{ run.stats.prunedNodes }}</dd>
        </div>
        <div class="bg-muted/60 rounded-lg px-2 py-2">
          <dt class="text-muted-foreground text-xs">{{ t('lab.results') }}</dt>
          <dd class="font-semibold tabular-nums">{{ run.results.length }}</dd>
        </div>
      </dl>
      <p class="text-muted-foreground text-xs">
        {{ t('lab.dawgSize', { nodes: run.nodeCount, edges: run.edgeCount }) }}
      </p>

      <ul v-if="run.results.length" class="space-y-1">
        <li v-for="r in run.results" :key="r.term" class="bg-accent text-accent-foreground flex justify-between rounded-md px-2 py-1">
          <span class="native-text font-medium">{{ r.term }}</span>
          <span class="font-mono text-xs tabular-nums">{{ formatDistance(r.distance) }}</span>
        </li>
      </ul>
    </div>

    <div class="min-w-0">
      <p class="text-muted-foreground mb-3 text-xs leading-relaxed">
        {{ t('lab.dawgHelp') }}
      </p>
      <ol class="scrollbar-thin max-h-[36rem] overflow-auto rounded-lg border py-1 font-mono text-sm" :aria-label="t('lab.dawgTrace')">
        <li
          v-for="(row, k) in run.rows"
          :key="k"
          :class="
            cn(
              'flex items-center gap-2 py-0.5 pr-3',
              !row.visit && 'text-muted-foreground/50',
              row.visit?.pruned && 'bg-destructive/10',
              row.visit?.accepted && 'bg-emerald-500/10',
            )
          "
          :style="{ paddingLeft: `${0.75 + row.depth * 1.1}rem` }"
        >
          <span class="w-4 text-center font-semibold" :class="row.visit && 'text-foreground'">{{ row.label === ' ' ? '␣' : row.label }}</span>
          <span v-if="row.terminal" class="native-text text-xs" :class="row.visit?.accepted && 'font-semibold text-emerald-700 dark:text-emerald-400'">
            {{ row.prefix }}
          </span>
          <span class="text-muted-foreground/60 text-[10px]">#{{ row.node }}</span>
          <span class="ml-auto flex shrink-0 items-center gap-2 text-xs tabular-nums">
            <template v-if="row.visit">
              <span v-if="row.visit.distance !== null" :class="row.visit.accepted ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'">
                d={{ formatDistance(row.visit.distance) }}
              </span>
              <span class="text-muted-foreground">{{ formatDistance(row.visit.lowerBound) }}／{{ formatDistance(row.visit.bound) }}</span>
              <span v-if="row.visit.pruned" class="text-destructive font-sans font-medium">{{ t('lab.pruned') }}</span>
            </template>
            <span v-else class="font-sans">{{ t('lab.notVisited') }}</span>
          </span>
        </li>
      </ol>
    </div>
  </div>
</template>
