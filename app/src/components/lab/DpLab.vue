<script setup>
/**
 * 「動態規劃表」分頁：輸入兩個詞，逐格顯示 D(i, j)，點選任一格看它的候選轉移，並顯示最佳對齊。
 * 播放由 src/fuzzy/steps.js 的 dpSteps 決定（每格一步，最後一步標出最佳路徑）。
 */
import { dpStateAt, dpSteps } from '@babizu/fuzzy/steps.js'
import { useEventListener } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import AlignmentStrip from '@/components/lab/AlignmentStrip.vue'
import CellInspector from '@/components/lab/CellInspector.vue'
import DpMatrix from '@/components/lab/DpMatrix.vue'
import PlaybackControls from '@/components/lab/PlaybackControls.vue'
import StepNote from '@/components/lab/StepNote.vue'
import { Input } from '@/components/ui/input'
import { usePlayback } from '@/composables/usePlayback.js'
import { t } from '@/i18n.js'
import { formatDistance, site } from '@/lib/labels.js'

const props = defineProps({
  /** 目前設定的 WeightedEditDistance */
  metric: { type: Object, required: true },
  /** 初始的兩個詞與步驟（網址參數） */
  initial: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:query'])

/** 顯示用的長度上限（code point），避免表格過大 */
const MAX_LENGTH = 24
/** 以 code point 截斷（UTF-16 切片會切壞非 BMP 字元） @param {unknown} s */
const clip = (s) => Array.from(String(s ?? '')).slice(0, MAX_LENGTH).join('')
/** 一鍵帶入的詞對（站台設定 lab.pairs）；第一組是預設值 */
const PRESETS = site.lab.pairs
const [DEFAULT_A, DEFAULT_B] = PRESETS[0] ?? ['', '']

const a = ref(clip(props.initial.a ?? DEFAULT_A))
const b = ref(clip(props.initial.b ?? DEFAULT_B))

const explanation = computed(() => props.metric.explain(clip(a.value), clip(b.value)))
const steps = computed(() => dpSteps(explanation.value))
const total = computed(() => steps.value.length)
const playback = usePlayback(total, { initial: props.initial.step })
const state = computed(() => dpStateAt(explanation.value, steps.value, playback.index.value))
const step = computed(() => (playback.index.value >= 0 ? steps.value[playback.index.value] : null))

/** 選取的格：預設右下角；播放時跟著目前格 */
const selected = ref(/** @type {[number, number] | null} */ (null))
watch(explanation, (e) => (selected.value = [e.query.length, e.candidate.length]), { immediate: true })
watch(
  () => state.value.focus,
  (f) => {
    if (f) selected.value = [f.i, f.j]
  },
)

watch([a, b, playback.index], () => emit('update:query', { a: a.value, b: b.value, step: playback.atEnd.value ? null : playback.index.value }))
useEventListener(window, 'keydown', playback.onKeydown)

/** @param {string[]} preset */
function usePreset([x, y]) {
  a.value = x
  b.value = y
}
</script>

<template>
  <div class="space-y-5">
    <!-- 輸入 -->
    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label for="lab-a" class="mb-1.5 block text-sm font-medium">{{ t('lab.queryRow') }}</label>
        <Input id="lab-a" v-model="a" :maxlength="MAX_LENGTH" class="native-text h-11 text-base" autocapitalize="off" autocorrect="off" spellcheck="false" />
      </div>
      <div>
        <label for="lab-b" class="mb-1.5 block text-sm font-medium">{{ t('lab.candidateColumn') }}</label>
        <Input id="lab-b" v-model="b" :maxlength="MAX_LENGTH" class="native-text h-11 text-base" autocapitalize="off" autocorrect="off" spellcheck="false" />
      </div>
    </div>
    <div v-if="PRESETS.length" class="flex flex-wrap gap-2">
      <button
        v-for="p in PRESETS"
        :key="p.join()"
        type="button"
        class="bg-card hover:bg-accent native-text min-h-9 rounded-sm border px-3 text-sm pointer-coarse:min-h-11"
        @click="usePreset(p)"
      >
        {{ p[0] }} / {{ p[1] }}
      </button>
    </div>

    <!-- 結果摘要 -->
    <div class="bg-card flex flex-wrap items-end gap-x-8 gap-y-3 rounded-xl border p-4">
      <div>
        <p class="text-muted-foreground text-xs">{{ t('lab.distance') }}</p>
        <p class="text-3xl font-semibold tabular-nums">{{ formatDistance(explanation.distance) }}</p>
      </div>
      <div class="text-sm">
        <p class="text-muted-foreground text-xs">{{ t('lab.normalized') }}</p>
        <p class="tabular-nums">
          max {{ formatDistance(explanation.normalized.max) }} · sum {{ formatDistance(explanation.normalized.sum) }} · query
          {{ formatDistance(explanation.normalized.query) }}
        </p>
      </div>
      <div class="w-full">
        <p class="text-muted-foreground mb-2 text-xs">{{ t('lab.bestAlignment') }}</p>
        <AlignmentStrip :steps="explanation.alignment" />
      </div>
    </div>

    <PlaybackControls :playback="playback" :total="total" />
    <StepNote :step="step" :playing="playback.playing.value" :idle="t('lab.playback.idleDp')" />

    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <DpMatrix
        :explanation="explanation"
        :revealed="state.revealed"
        :show-path="state.showPath"
        :focus="state.focus"
        :selected="selected"
        @select="(cell) => (selected = cell)"
      />
      <CellInspector v-if="selected" :explanation="explanation" :cell="selected" />
    </div>
    <p class="text-muted-foreground text-xs leading-relaxed">
      {{ t('lab.legend') }}
    </p>
  </div>
</template>
