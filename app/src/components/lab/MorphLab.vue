<script setup>
/**
 * 「構詞 BCDP」分頁（docs/lab-design.md 第 4 節）：逐步展示構詞搜尋怎麼找到詞根。
 *
 * 資料來自搜尋 Worker 的 explainMorphology（與搜尋同一套程式、同一個總成本上限），
 * 播放由 src/fuzzy/steps.js 的 bcdpSteps 決定。四個面板依計算順序排列：
 * ① 詞綴圖表 → ② 還原變體與詞圖走訪 → ③ 計價格網 → ④ 最終分析。
 */
import { bcdpStateAt, bcdpSteps } from '@babizu/fuzzy/steps.js'
import { createSearchMetric } from '@babizu/search/text.js'
import { useDebounceFn, useEventListener } from '@vueuse/core'
import { computed, ref, shallowRef, watch } from 'vue'
import AlignmentStrip from '@/components/lab/AlignmentStrip.vue'
import PlaybackControls from '@/components/lab/PlaybackControls.vue'
import StepNote from '@/components/lab/StepNote.vue'
import { Input } from '@/components/ui/input'
import { usePlayback } from '@/composables/usePlayback.js'
import { t } from '@/i18n.js'
import { formatDistance, morphGloss, site } from '@/lib/labels.js'
import { cn } from '@/lib/utils'
import { getSearchClient } from '@/services/search-client.js'

const props = defineProps({
  /** 初始的查詢、詞根與步驟（網址參數） */
  initial: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:query'])

/** 說明詞幹音變用的距離函式：與搜尋引擎相同（站台的規則，不受實驗室的規則設定影響） */
const metric = createSearchMetric(site.profile)
const EXAMPLES = site.lab.morph?.examples ?? []
const FAILURES = site.lab.morph?.failures ?? []
const DOCS = 'https://github.com/Babizu/babizu/blob/main/docs/'

const q = ref(String(props.initial.q ?? EXAMPLES[0]?.[0] ?? ''))
const term = ref(String(props.initial.t ?? (props.initial.q ? '' : (EXAMPLES[0]?.[1] ?? ''))))
/** @type {import('vue').ShallowRef<any>} */
const e = shallowRef(null)
const loading = ref(false)
const failed = ref(false)

let request = 0
const load = useDebounceFn(async () => {
  const id = ++request
  if (!q.value.trim()) {
    e.value = null
    return
  }
  loading.value = true
  failed.value = false
  try {
    const result = await getSearchClient().explainMorphology(q.value, term.value.trim() || null)
    if (id === request) e.value = result
  } catch {
    if (id === request) failed.value = true
  } finally {
    if (id === request) loading.value = false
  }
}, 250)
watch([q, term], load, { immediate: true })

const steps = computed(() => (e.value ? bcdpSteps(e.value) : []))
const total = computed(() => steps.value.length)
const playback = usePlayback(total, { initial: props.initial.step })
const state = computed(() => (e.value ? bcdpStateAt(e.value, steps.value, playback.index.value) : null))
const step = computed(() => (playback.index.value >= 0 ? steps.value[playback.index.value] : null))
const focus = computed(() => /** @type {any} */ (state.value?.focus ?? null))
useEventListener(window, 'keydown', playback.onKeydown)
watch([q, term, playback.index], () =>
  emit('update:query', { q: q.value, t: term.value || null, step: playback.atEnd.value ? null : playback.index.value }),
)

/** @param {string[]} example */
function useExample([x, y]) {
  q.value = x
  term.value = y
}
/** @param {number | null} v */
const fmt = (v) => formatDistance(v ?? Infinity)
/** 查詢的第 i 個位置之前的字元（表頭；0 是 ε） @param {number} i */
const charBefore = (i) => (i === 0 ? 'ε' : e.value.chars[i - 1] === ' ' ? '␣' : e.value.chars[i - 1])

// ── ② 還原變體 ──
/**
 * 以原查詢標出變體拿掉的部分（中綴、重疊部分畫刪除線）；詞幹交替改寫了字元，直接顯示變體。
 * 變體的第 j 個字元對應原查詢的第 origin[j + 1] − 1 個字元（origin 是位置的對應）。
 * @param {any} v
 * @returns {Array<{text: string, removed: boolean}>}
 */
function variantPieces(v) {
  if (!v.op || v.op.type === 'alternation') return [{ text: v.text, removed: false }]
  const kept = new Set(v.chars.map((/** @type {string} */ _, /** @type {number} */ j) => v.origin[j + 1] - 1))
  /** @type {Array<{text: string, removed: boolean}>} */
  const pieces = []
  e.value.chars.forEach((/** @type {string} */ ch, /** @type {number} */ i) => {
    const removed = !kept.has(i)
    const last = pieces.at(-1)
    if (last && last.removed === removed) last.text += ch
    else pieces.push({ text: ch, removed })
  })
  return pieces
}
/** 變體的說明（原查詢、中綴、重疊、交替） @param {any} v */
function variantLabel(v) {
  if (!v.op) return t('lab.morph.original')
  return `${t(`morph.type.${v.op.type}`)} ${v.op.type === 'infix' ? `<${v.op.form}>` : v.op.form}`
}

// ── ③ 計價格網 ──
const pricing = computed(() => (e.value?.pricing ?? []).filter((/** @type {any} */ p) => p.candidate))
/** @param {any} p */
const pricingRows = (p) => [...new Set(p.cells.map((/** @type {any} */ c) => c.i))].sort((a, b) => a - b)
/** @param {any} p */
const pricingCols = (p) => [...new Set(p.cells.map((/** @type {any} */ c) => c.k))].sort((a, b) => a - b)
/** @param {any} p @param {number} i @param {number} k */
const cellAt = (p, i, k) => p.cells.find((/** @type {any} */ c) => c.i === i && c.k === k) ?? null
/** @param {any} p @param {number} i @param {number} k */
const isPriced = (p, i, k) => state.value?.priced[p.variant]?.some((/** @type {any} */ c) => c.i === i && c.k === k) ?? false
/** 最佳格（整個變體計價完之後才標出） @param {any} p @param {number} i @param {number} k */
const isBest = (p, i, k) => Boolean(p.best && p.best.i === i && p.best.k === k && (state.value?.priced[p.variant]?.length ?? 0) >= p.cells.length)

// ── ④ 最終分析 ──
/** 依詞形中的位置排列的步驟：前綴、重疊與中綴、詞幹、交替、後綴 */
const pieces = computed(() => {
  const hit = e.value?.hit
  if (!hit) return []
  const outer = hit.steps
  const before = outer.filter((/** @type {any} */ s) => s.type === 'prefix' || s.type === 'reduplication' || s.type === 'infix')
  const alternation = outer.filter((/** @type {any} */ s) => s.type === 'alternation')
  const after = outer.filter((/** @type {any} */ s) => s.type === 'suffix').reverse()
  return [
    ...before.map((/** @type {any} */ s) => ({ kind: s.type, text: s.type === 'prefix' ? `${s.surface ?? s.form}-` : s.type === 'infix' ? `<${s.form}>` : `${s.form}~`, cost: s.cost, gloss: s.gloss })),
    { kind: 'stem', text: hit.stemSurface, cost: hit.stemDistance, gloss: null },
    ...alternation.map((/** @type {any} */ s) => ({ kind: s.type, text: s.form, cost: s.cost, gloss: null })),
    ...after.map((/** @type {any} */ s) => ({ kind: s.type, text: `-${s.surface ?? s.form}`, cost: s.cost, gloss: s.gloss })),
  ]
})
/** 詞幹片段對詞根的對齊（與搜尋相同的距離函式） */
const stemAlignment = computed(() => {
  const hit = e.value?.hit
  if (!hit || hit.stemDistance === 0) return null
  return metric.explainChars(Array.from(hit.stemSurface), metric.prepare(hit.term)).alignment
})

/** 面板是否已經輪到（目前階段之後的面板淡化） */
const PHASES = ['charts', 'variants', 'walk', 'pricing', 'result']
/** @param {string} phase */
const reached = (phase) => state.value && (state.value.result || PHASES.indexOf(state.value.phase) >= PHASES.indexOf(phase))
const PANEL = 'bg-card rounded-lg border p-4'
</script>

<template>
  <div class="space-y-5">
    <!-- 輸入 -->
    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label for="morph-q" class="mb-1.5 block text-sm font-medium">{{ t('lab.morph.query') }}</label>
        <Input id="morph-q" v-model="q" class="native-text h-11 text-base" autocapitalize="off" autocorrect="off" spellcheck="false" />
      </div>
      <div>
        <label for="morph-t" class="mb-1.5 block text-sm font-medium">{{ t('lab.morph.term') }}</label>
        <Input
          id="morph-t"
          v-model="term"
          :placeholder="t('lab.morph.termPlaceholder')"
          class="native-text h-11 text-base"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
        />
      </div>
    </div>
    <div v-if="EXAMPLES.length || FAILURES.length" class="flex flex-wrap items-center gap-2 text-sm">
      <button
        v-for="p in EXAMPLES"
        :key="`e-${p.join()}`"
        type="button"
        class="bg-card hover:bg-accent native-text min-h-9 rounded-sm border px-3 pointer-coarse:min-h-11"
        @click="useExample(p)"
      >
        {{ p[0] }} → {{ p[1] }}
      </button>
      <span v-if="FAILURES.length" class="text-muted-foreground ml-1 text-xs">{{ t('lab.morph.failures') }}</span>
      <button
        v-for="p in FAILURES"
        :key="`f-${p.join()}`"
        type="button"
        class="bg-card hover:bg-accent native-text text-muted-foreground min-h-9 rounded-sm border border-dashed px-3 pointer-coarse:min-h-11"
        @click="useExample(p)"
      >
        {{ p[0] }} ↛ {{ p[1] }}
      </button>
    </div>

    <p v-if="failed" class="text-muted-foreground text-sm">{{ t('lab.morph.error') }}</p>
    <p v-else-if="!e && !loading" class="text-muted-foreground text-sm">{{ t('lab.morph.empty') }}</p>

    <div v-if="e" class="space-y-5" :aria-busy="loading">
      <!-- 命中 -->
      <div class="bg-card rounded-xl border p-4">
        <p class="text-muted-foreground mb-2 text-xs">{{ t('lab.morph.hits', { count: e.hits?.length ?? 0 }) }}</p>
        <ul v-if="e.hits?.length" class="flex flex-wrap gap-2">
          <li v-for="h in e.hits" :key="h.term">
            <button
              type="button"
              :class="
                cn(
                  'native-text min-h-9 rounded-sm border px-2.5 text-sm pointer-coarse:min-h-11',
                  h.term === e.term ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-accent',
                )
              "
              :aria-pressed="h.term === e.term"
              @click="term = h.term"
            >
              {{ h.term }} <span class="font-mono text-xs tabular-nums opacity-80">{{ fmt(h.distance) }}</span>
            </button>
          </li>
        </ul>
        <p v-if="e.cutoff !== null" class="text-muted-foreground mt-2 text-xs">{{ t('lab.morph.cutoff', { cutoff: fmt(e.cutoff) }) }}</p>
      </div>

      <PlaybackControls :playback="playback" :total="total" />
      <StepNote :step="step" :playing="playback.playing.value" :idle="t('lab.playback.idleMorph')" />

      <template v-if="!e.tooShort && state">
        <!-- ① 詞綴圖表 -->
        <section :class="cn(PANEL, !reached('charts') && 'opacity-50')" aria-labelledby="morph-charts">
          <h3 id="morph-charts" class="mb-3 flex items-baseline justify-between gap-3 text-sm font-semibold">
            {{ t('lab.morph.charts') }}
            <a :href="`${DOCS}bcdp.md#5-詞綴圖表是最短路徑`" target="_blank" rel="noopener" class="text-primary text-xs font-normal">bcdp.md §5</a>
          </h3>
          <div class="scrollbar-thin overflow-x-auto">
            <table class="border-collapse font-mono text-xs tabular-nums" :aria-label="t('lab.morph.charts')">
              <thead>
                <tr>
                  <th class="bg-muted h-9 min-w-11 border px-2 text-left font-sans font-normal" scope="col">{{ t('lab.morph.position') }}</th>
                  <th v-for="(_, i) in e.chars.length + 1" :key="i" scope="col" class="bg-muted relative h-9 min-w-11 border px-1 font-sans font-medium">
                    <span class="native-text text-sm">{{ charBefore(i) }}</span>
                    <span class="text-muted-foreground absolute right-1 bottom-0.5 text-[9px] font-normal">{{ i }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="table in ['P', 'S']" :key="table">
                  <th scope="row" class="bg-muted h-9 border px-2 text-left font-sans font-normal">{{ t(`lab.morph.chart${table}`) }}</th>
                  <td
                    v-for="(_, i) in e.chars.length + 1"
                    :key="i"
                    :class="
                      cn(
                        'lab-cell h-9 min-w-11 border text-center',
                        state[table][i] === null && 'text-muted-foreground/50',
                        focus?.table === table && focus?.at === i && 'ring-primary ring-2 ring-inset',
                      )
                    "
                  >
                    {{ fmt(state[table][i]) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ② 還原變體與詞圖走訪 -->
        <section :class="cn(PANEL, !reached('variants') && 'opacity-50')" aria-labelledby="morph-variants">
          <h3 id="morph-variants" class="mb-3 flex items-baseline justify-between gap-3 text-sm font-semibold">
            {{ t('lab.morph.variants') }}
            <a :href="`${DOCS}bcdp.md#7-非串接步驟還原變體`" target="_blank" rel="noopener" class="text-primary text-xs font-normal">bcdp.md §7–8</a>
          </h3>
          <ol class="space-y-2">
            <li
              v-for="(v, vi) in e.variants"
              v-show="vi < state.variants"
              :key="vi"
              :class="cn('lab-cell grid gap-x-4 gap-y-1 rounded-md border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]', focus?.variant === vi && 'ring-primary ring-2 ring-inset')"
            >
              <div class="min-w-0">
                <p class="native-text text-base">
                  <template v-for="(piece, k) in variantPieces(v)" :key="k">
                    <del v-if="piece.removed" class="bg-muted text-muted-foreground decoration-foreground/60 rounded-sm px-px">{{ piece.text }}</del>
                    <template v-else>{{ piece.text }}</template>
                  </template>
                  <span v-if="v.op && v.op.type !== 'alternation'" class="text-muted-foreground ml-2 text-sm">→ {{ v.text }}</span>
                </p>
                <p class="text-muted-foreground text-xs">{{ variantLabel(v) }}</p>
              </div>
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span class="flex items-center gap-1" :aria-label="t('lab.morph.startsLabel', { count: v.starts.length })">
                  {{ t('lab.morph.start') }}
                  <span v-for="(c, i) in v.start" :key="i" :class="cn('size-2 rounded-full border', c !== null ? 'bg-foreground border-foreground' : 'border-muted-foreground/60')" aria-hidden="true" />
                </span>
                <span class="flex items-center gap-1" :aria-label="t('lab.morph.endsLabel', { count: v.ends.length })">
                  {{ t('lab.morph.end') }}
                  <span v-for="(c, i) in v.end" :key="i" :class="cn('size-2 rounded-full border', c !== null ? 'bg-foreground border-foreground' : 'border-muted-foreground/60')" aria-hidden="true" />
                </span>
                <span class="text-muted-foreground tabular-nums">
                  {{ vi < state.walks ? t('lab.morph.candidates', { count: e.candidates[vi].length }) : '…' }}
                </span>
              </div>
            </li>
          </ol>
          <p v-if="e.truncated" class="text-muted-foreground mt-2 text-xs">{{ t('lab.morph.truncated') }}</p>
        </section>

        <!-- ③ 計價格網 -->
        <section v-if="e.term" :class="cn(PANEL, !reached('pricing') && 'opacity-50')" aria-labelledby="morph-pricing">
          <h3 id="morph-pricing" class="mb-3 flex items-baseline justify-between gap-3 text-sm font-semibold">
            {{ t('lab.morph.pricing', { term: e.term }) }}
            <a :href="`${DOCS}bcdp.md#9-兩階段候選與計價`" target="_blank" rel="noopener" class="text-primary text-xs font-normal">bcdp.md §9</a>
          </h3>
          <p v-if="!pricing.length" class="text-muted-foreground text-sm">{{ t('lab.morph.notCandidate', { term: e.term }) }}</p>
          <div v-for="p in pricing" :key="p.variant" class="mb-4 last:mb-0">
            <p class="native-text text-muted-foreground mb-1.5 text-xs">{{ e.variants[p.variant].text }}</p>
            <div class="scrollbar-thin overflow-x-auto">
              <table class="border-collapse font-mono text-xs tabular-nums" :aria-label="t('lab.morph.pricing', { term: e.term })">
                <thead>
                  <tr>
                    <th class="bg-muted h-9 min-w-14 border px-2 font-sans font-normal" scope="col">i ＼ k</th>
                    <th v-for="k in pricingCols(p)" :key="k" scope="col" class="bg-muted h-9 min-w-16 border px-2 font-sans font-medium">{{ k }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="i in pricingRows(p)" :key="i">
                    <th scope="row" class="bg-muted h-9 border px-2 font-sans font-medium">{{ i }}</th>
                    <td
                      v-for="k in pricingCols(p)"
                      :key="k"
                      :class="
                        cn(
                          'lab-cell h-9 min-w-16 border px-2 text-center',
                          isBest(p, i, k) && 'bg-primary text-primary-foreground font-semibold',
                          focus?.variant === p.variant && focus?.i === i && focus?.k === k && (isBest(p, i, k) ? 'ring-primary-foreground ring-2 ring-inset' : 'ring-primary ring-2 ring-inset'),
                          (!cellAt(p, i, k) || !isPriced(p, i, k)) && 'text-muted-foreground/50',
                        )
                      "
                      :title="cellAt(p, i, k) ? e.variants[p.variant].chars.slice(i, k).join('') : undefined"
                    >
                      <template v-if="!cellAt(p, i, k)">—</template>
                      <template v-else-if="!isPriced(p, i, k)">·</template>
                      <template v-else-if="cellAt(p, i, k).skip">{{ t(`lab.morph.skip.${cellAt(p, i, k).skip}`) }}</template>
                      <template v-else>{{ fmt(cellAt(p, i, k).total) }}</template>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <p class="text-muted-foreground mt-2 text-xs">{{ t('lab.morph.pricingLegend') }}</p>
        </section>

        <!-- ④ 最終分析 -->
        <section :class="cn(PANEL, !state.result && 'opacity-50')" aria-labelledby="morph-analysis">
          <h3 id="morph-analysis" class="mb-3 flex items-baseline justify-between gap-3 text-sm font-semibold">
            {{ t('lab.morph.analysis') }}
            <a :href="`${DOCS}bcdp.md#1-問題`" target="_blank" rel="noopener" class="text-primary text-xs font-normal">bcdp.md §1</a>
          </h3>
          <template v-if="e.hit">
            <ol class="flex flex-wrap items-stretch gap-1.5" :aria-label="t('lab.morph.analysis')">
              <li
                v-for="(piece, k) in pieces"
                :key="k"
                :class="
                  cn(
                    'flex flex-col items-center rounded-md px-2.5 py-1',
                    piece.kind === 'stem' ? (state.result ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground') : 'bg-muted',
                  )
                "
              >
                <span class="native-text text-base leading-tight">{{ piece.text }}</span>
                <span class="text-[10px] leading-tight opacity-80">
                  {{ piece.kind === 'stem' ? `≈ ${e.hit.term}` : morphGloss(piece.gloss) || t(`morph.type.${piece.kind}`) }}
                </span>
                <span class="font-mono text-[10px] tabular-nums opacity-80">+{{ fmt(piece.cost) }}</span>
              </li>
            </ol>
            <p class="mt-3 font-mono text-sm tabular-nums">
              {{ pieces.map((p) => fmt(p.cost)).join(' ＋ ') }} ＝ <span class="font-semibold">{{ fmt(e.hit.distance) }}</span>
            </p>
            <div v-if="stemAlignment" class="mt-3">
              <p class="text-muted-foreground mb-2 text-xs">{{ t('lab.morph.stemAlignment', { stem: e.hit.stemSurface, term: e.hit.term }) }}</p>
              <AlignmentStrip :steps="stemAlignment" compact />
            </div>
          </template>
          <p v-else-if="e.term" class="text-muted-foreground text-sm">
            {{ t(`lab.note.bcdp.miss.${e.reason}`, { term: e.term, lambda: fmt(e.params.lemmaDistance), maxDistance: fmt(e.params.maxDistance), cutoff: fmt(e.cutoff) }) }}
          </p>
          <p v-else class="text-muted-foreground text-sm">{{ t('lab.morph.pickTerm') }}</p>
        </section>
      </template>
    </div>
  </div>
</template>
