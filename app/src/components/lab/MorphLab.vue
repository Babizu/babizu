<script setup>
/**
 * 「構詞 BCDP」分頁（docs/lab-design.md 第 4 節）：逐步展示構詞搜尋怎麼找到詞根。
 *
 * 資料來自搜尋 Worker 的 explainMorphology（與搜尋同一套程式、同一個總成本上限），
 * 播放由 src/fuzzy/steps.js 的 bcdpSteps 決定。四個面板依計算順序排列：
 * ① 詞綴各層與交界狀態 → ② 通道與詞圖走訪 → ③ 整個詞的對齊 → ④ 分析。
 */
import { bcdpStateAt, bcdpSteps } from '@babizu/fuzzy/steps.js'
import { useDebounceFn, useEventListener } from '@vueuse/core'
import { computed, ref, shallowRef, watch } from 'vue'
import AlignmentStrip from '@/components/lab/AlignmentStrip.vue'
import PlaybackControls from '@/components/lab/PlaybackControls.vue'
import StepNote from '@/components/lab/StepNote.vue'
import { Input } from '@/components/ui/input'
import { usePlayback } from '@/composables/usePlayback.js'
import { t } from '@/i18n.js'
import { formatDistance, formatMorphStep, morphGloss, site } from '@/lib/labels.js'
import { cn } from '@/lib/utils'
import { getSearchClient } from '@/services/search-client.js'

const props = defineProps({
  /** 初始的查詢、詞根與步驟（網址參數） */
  initial: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:query'])

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

// ── ① 詞綴各層：前綴各層、前綴合併、後綴各層、後綴合併（依計算順序顯示） ──
const levelRows = computed(() => {
  const x = e.value
  if (!x || x.tooShort) return []
  return [
    ...x.prefixLevels.map((/** @type {any[]} */ row, /** @type {number} */ s) => ({
      key: `p${s}`,
      label: t('lab.morph.levelPrefix', { level: s + 1 }),
      row,
      shown: (state.value?.prefixLevels ?? 0) > s,
      focused: focus.value?.side === 'prefix' && focus.value?.level === s + 1,
    })),
    { key: 'P', label: t('lab.morph.mergedP'), row: x.merged.P, shown: state.value?.merged, focused: state.value?.merged && step.value?.kind === 'merge', merged: true },
    ...x.suffixLevels.map((/** @type {any[]} */ row, /** @type {number} */ s) => ({
      key: `s${s}`,
      label: t('lab.morph.levelSuffix', { level: s + 1 }),
      row,
      shown: (state.value?.suffixLevels ?? 0) > s,
      focused: focus.value?.side === 'suffix' && focus.value?.level === s + 1,
    })),
    { key: 'S', label: t('lab.morph.mergedS'), row: x.merged.S, shown: state.value?.merged, focused: state.value?.merged && step.value?.kind === 'merge', merged: true },
  ]
})

// ── ② 通道 ──
/** 通道的說明 @param {any} v */
const channelLabel = (v) => {
  // 前綴式環綴的通道由後綴相同的幾個環綴共用：列出它們
  if (v.kind === 'circumfix') return t('lab.morph.channel.circumfix', { form: (v.options ?? []).map(formatMorphStep).join('、') })
  // 還原變體：同一種拿法的步驟（單獨的中綴、重疊，與用它當左邊的環綴）共用一個通道，逐一列出
  /** @param {any} op */
  const one = (op) =>
    op.type === 'circumfix'
      ? t('lab.morph.channel.circumfixInner', { form: formatMorphStep(op), left: op.left.form })
      : t(`lab.morph.channel.${v.kind}`, { form: op.form })
  const label = v.op ? (v.options ?? [v.op]).map(one).join('；') : t(`lab.morph.channel.${v.kind}`, { form: '' })
  return label + (v.op && v.prefixed ? t('lab.morph.channel.afterPrefix') : '')
}

// ── ③ 整個詞的對齊 ──
/** 各詞素依序排列，交界以｜分開 */
const segments = computed(() => (e.value?.alignment?.segments ?? []).map((/** @type {any} */ s) => ({ ...s, text: formatMorphStep({ type: s.type, form: s.form }) })))
const alignedSteps = computed(() => (e.value?.alignment?.steps ?? []).slice(0, state.value?.aligned ?? 0))

// ── ④ 分析 ──
const stepCost = computed(() => (e.value?.hit?.steps ?? []).reduce((/** @type {number} */ sum, /** @type {any} */ s) => sum + s.cost, 0))
/** 步驟依詞中的順序排列（hit.steps 由外而內）：前綴、重疊在詞幹前，中綴在詞幹上，後綴在詞幹後 */
const pieces = computed(() => {
  const all = e.value?.hit?.steps ?? []
  const of = (/** @type {string[]} */ types) => all.filter((/** @type {any} */ s) => types.includes(s.type))
  // 環綴緊貼詞幹，放在前綴之後（晶片上寫成 ta-…-aw）
  return { before: of(['prefix', 'reduplication', 'circumfix']), inner: of(['infix']), after: of(['suffix']).reverse() }
})

/** 面板是否已經輪到（目前階段之後的面板淡化） */
const PHASES = ['levels', 'channels', 'result', 'alignment']
/** @param {string} phase */
const reached = (phase) => state.value && PHASES.indexOf(state.value.phase) >= PHASES.indexOf(phase)
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
        <!-- ① 詞綴各層與交界狀態 -->
        <section :class="PANEL" aria-labelledby="morph-levels">
          <h3 id="morph-levels" class="mb-3 flex items-baseline justify-between gap-3 text-sm font-semibold">
            {{ t('lab.morph.levels') }}
            <a :href="`${DOCS}bcdp.md#5-詞綴一層一層合併`" target="_blank" rel="noopener" class="text-primary text-xs font-normal">bcdp.md §4–5</a>
          </h3>
          <div class="scrollbar-thin overflow-x-auto">
            <table class="border-collapse font-mono text-xs tabular-nums" :aria-label="t('lab.morph.levels')">
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
                <tr v-for="r in levelRows" :key="r.key" :class="cn(!r.shown && 'opacity-40', r.merged && 'border-t-2')">
                  <th scope="row" :class="cn('bg-muted h-9 border px-2 text-left font-sans font-normal whitespace-nowrap', r.merged && 'font-medium')">{{ r.label }}</th>
                  <td
                    v-for="(v, i) in r.row"
                    :key="i"
                    :class="cn('lab-cell h-9 min-w-11 border text-center', (!r.shown || v === null) && 'text-muted-foreground/50', r.focused && 'ring-primary ring-2 ring-inset')"
                  >
                    {{ r.shown ? fmt(v) : '·' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="text-muted-foreground mt-2 text-xs">{{ t('lab.morph.levelsLegend') }}</p>
          <p v-if="state.merged && e.merged.crossingP.length + e.merged.crossingS.length" class="text-muted-foreground mt-1 text-xs">
            {{ t('lab.morph.crossing', { prefix: e.merged.crossingP.length, suffix: e.merged.crossingS.length }) }}
          </p>
        </section>

        <!-- ② 通道與詞圖走訪 -->
        <section :class="cn(PANEL, !reached('channels') && 'opacity-50')" aria-labelledby="morph-channels">
          <h3 id="morph-channels" class="mb-3 flex items-baseline justify-between gap-3 text-sm font-semibold">
            {{ t('lab.morph.channels') }}
            <a :href="`${DOCS}bcdp.md#7-詞幹一次走訪與耦合`" target="_blank" rel="noopener" class="text-primary text-xs font-normal">bcdp.md §6–7</a>
          </h3>
          <ol class="space-y-2">
            <li
              v-for="(v, c) in e.variants"
              v-show="c < state.channels"
              :key="c"
              :class="cn('lab-cell grid gap-x-4 gap-y-1 rounded-md border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]', focus?.channel === c && 'ring-primary ring-2 ring-inset')"
            >
              <div class="min-w-0">
                <p class="native-text text-base">{{ v.text }}</p>
                <p class="text-muted-foreground text-xs">{{ channelLabel(v) }}</p>
              </div>
              <p class="text-muted-foreground self-center text-xs tabular-nums">
                {{ c < state.walks ? t('lab.morph.walkResult', { visited: e.walks[c].length, found: e.candidates[c].length }) : '…' }}
              </p>
            </li>
          </ol>
          <p v-if="e.truncated" class="text-muted-foreground mt-2 text-xs">{{ t('lab.morph.truncated') }}</p>
        </section>

        <!-- ③ 整個詞的對齊 -->
        <section v-if="e.alignment" :class="cn(PANEL, !reached('alignment') && !state.result && 'opacity-50')" aria-labelledby="morph-alignment">
          <h3 id="morph-alignment" class="mb-3 flex items-baseline justify-between gap-3 text-sm font-semibold">
            {{ t('lab.morph.alignment', { term: e.term }) }}
            <a :href="`${DOCS}bcdp.md#8-說明找回詞綴鏈與整個詞的對齊`" target="_blank" rel="noopener" class="text-primary text-xs font-normal">bcdp.md §8</a>
          </h3>
          <p class="native-text mb-3 flex flex-wrap items-center gap-1 text-base">
            <template v-for="(s, k) in segments" :key="k">
              <span v-if="k > 0" class="text-muted-foreground px-0.5" aria-hidden="true">｜</span>
              <span :class="cn('rounded-sm px-1.5', s.type === 'stem' ? 'bg-accent text-accent-foreground' : 'bg-muted')">{{ s.text }}</span>
            </template>
          </p>
          <AlignmentStrip :steps="alignedSteps" compact />
          <p class="text-muted-foreground mt-2 text-xs">{{ t('lab.morph.alignmentLegend') }}</p>
        </section>

        <!-- ④ 分析 -->
        <section :class="cn(PANEL, !state.result && 'opacity-50')" aria-labelledby="morph-analysis">
          <h3 id="morph-analysis" class="mb-3 flex items-baseline justify-between gap-3 text-sm font-semibold">
            {{ t('lab.morph.analysis') }}
            <a :href="`${DOCS}bcdp.md#1-問題`" target="_blank" rel="noopener" class="text-primary text-xs font-normal">bcdp.md §1</a>
          </h3>
          <template v-if="e.hit">
            <ol class="flex flex-wrap items-stretch gap-1.5" :aria-label="t('lab.morph.analysis')">
              <li v-for="(s, k) in pieces.before" :key="`b${k}`" class="bg-muted flex flex-col items-center rounded-md px-2.5 py-1">
                <span class="native-text text-base leading-tight">{{ formatMorphStep(s) }}</span>
                <span class="text-[10px] leading-tight opacity-80">{{ morphGloss(s.gloss) || t(`morph.type.${s.type}`) }}</span>
                <span class="font-mono text-[10px] tabular-nums opacity-80">+{{ fmt(s.cost) }}</span>
              </li>
              <li :class="cn('flex flex-col items-center rounded-md px-2.5 py-1', state.result ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground')">
                <span class="native-text text-base leading-tight">{{ e.hit.term }}</span>
                <span class="text-[10px] leading-tight opacity-80">{{ t('morph.where.stem') }}</span>
              </li>
              <li v-for="(s, k) in [...pieces.inner, ...pieces.after]" :key="`a${k}`" class="bg-muted flex flex-col items-center rounded-md px-2.5 py-1">
                <span class="native-text text-base leading-tight">{{ formatMorphStep(s) }}</span>
                <span class="text-[10px] leading-tight opacity-80">{{ morphGloss(s.gloss) || t(`morph.type.${s.type}`) }}</span>
                <span class="font-mono text-[10px] tabular-nums opacity-80">+{{ fmt(s.cost) }}</span>
              </li>
              <li class="bg-muted flex flex-col items-center rounded-md px-2.5 py-1">
                <span class="text-base leading-tight">≈</span>
                <span class="text-[10px] leading-tight opacity-80">{{ t('lab.morph.soundCost') }}</span>
                <span class="font-mono text-[10px] tabular-nums opacity-80">+{{ fmt(e.alignment?.distance ?? 0) }}</span>
              </li>
            </ol>
            <p class="mt-3 font-mono text-sm tabular-nums">
              {{ fmt(stepCost) }} ＋ {{ fmt(e.alignment?.distance ?? 0) }} ＝ <span class="font-semibold">{{ fmt(e.hit.distance) }}</span>
            </p>
          </template>
          <p v-else-if="e.term" class="text-muted-foreground text-sm">
            {{ t(`lab.note.bcdp.miss.${e.reason}`, { term: e.term, maxDistance: fmt(e.params.maxDistance), cutoff: fmt(e.cutoff) }) }}
          </p>
          <p v-else class="text-muted-foreground text-sm">{{ t('lab.morph.pickTerm') }}</p>
        </section>
      </template>
    </div>
  </div>
</template>
