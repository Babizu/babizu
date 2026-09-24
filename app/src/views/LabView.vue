<script setup>
/**
 * 演算法實驗室：視覺化跨方言加權編輯距離的計算。
 *
 * - 「動態規劃表」分頁：輸入兩個詞，逐格顯示 D(i, j)，點選任一格看它的候選轉移，
 *   並顯示最佳對齊；可逐格播放計算順序
 * - 「詞圖搜尋」分頁：顯示詞圖（DAWG）搜尋時的走訪與剪枝
 * - 「規則與成本設定」可調整規則與成本，兩個分頁即時更新
 *
 * 網址參數 ?a=…&b=… 可指定要比較的兩個詞（搜尋結果的「查看計算過程」連結即使用此參數）。
 */
import { PauseIcon, PlayIcon, SkipForwardIcon, StepForwardIcon } from '@lucide/vue'
import { useIntervalFn, useMediaQuery } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AlignmentStrip from '@/components/lab/AlignmentStrip.vue'
import CellInspector from '@/components/lab/CellInspector.vue'
import DpMatrix from '@/components/lab/DpMatrix.vue'
import { createLabState } from '@/components/lab/lab-state.js'
import RuleEditor from '@/components/lab/RuleEditor.vue'
import DawgExplorer from '@/components/lab/DawgExplorer.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { t } from '@/i18n.js'
import { COSTS, formatDistance, site } from '@/lib/labels.js'

const route = useRoute()
const { state, metric, activeRuleCount, reset } = createLabState()
/** 桌面把設定放在側欄；行動裝置收合在內容下方（只渲染一份） */
const isDesktop = useMediaQuery('(min-width: 1024px)')

/** 顯示用的長度上限，避免表格過大 */
const MAX_LENGTH = 24
/** 一鍵帶入的詞對（站台設定 lab.pairs）；第一組是預設值 */
const PRESETS = site.lab.pairs
const [DEFAULT_A, DEFAULT_B] = PRESETS[0] ?? ['', '']

const a = ref(String(route.query.a ?? DEFAULT_A).slice(0, MAX_LENGTH))
const b = ref(String(route.query.b ?? DEFAULT_B).slice(0, MAX_LENGTH))
const tab = ref('dp')

const explanation = computed(() => metric.value.explain(a.value.slice(0, MAX_LENGTH), b.value.slice(0, MAX_LENGTH)))
const totalCells = computed(() => explanation.value.order.length)

// ---- 逐格動畫 ----
const revealed = ref(Infinity)
const selected = ref(/** @type {[number, number] | null} */ (null))
const { pause, resume, isActive: playing } = useIntervalFn(
  () => {
    if (revealed.value >= totalCells.value) {
      pause()
      revealed.value = Infinity
      return
    }
    revealed.value++
    selected.value = explanation.value.order[revealed.value - 1] ?? null
  },
  180,
  { immediate: false },
)

function play() {
  if (!Number.isFinite(revealed.value) || revealed.value >= totalCells.value) revealed.value = 0
  resume()
}
function step() {
  pause()
  if (!Number.isFinite(revealed.value) || revealed.value >= totalCells.value) revealed.value = 0
  revealed.value++
  selected.value = explanation.value.order[revealed.value - 1] ?? null
}
function showAll() {
  pause()
  revealed.value = Infinity
}

// 輸入或規則改變時：停止動畫、顯示完整結果、選取右下角
watch(
  explanation,
  (e) => {
    pause()
    revealed.value = Infinity
    selected.value = [e.query.length, e.candidate.length]
  },
  { immediate: true },
)

/** @param {[number, number]} cell */
function onSelect(cell) {
  selected.value = cell
}

/** @param {string[]} preset */
function usePreset([x, y]) {
  a.value = x
  b.value = y
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
    <header class="mb-6 max-w-3xl">
      <h1 class="font-serif text-3xl font-bold tracking-tight">{{ t('page.lab') }}</h1>
      <p class="text-muted-foreground mt-2 leading-relaxed">
        {{ COSTS.rule === null ? t('lab.introNoRules') : t('lab.intro', { rule: COSTS.rule }) }}
      </p>
    </header>

    <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Tabs v-model="tab" class="min-w-0 gap-5">
        <TabsList class="h-10">
          <TabsTrigger value="dp" class="px-4">{{ t('lab.matrix') }}</TabsTrigger>
          <TabsTrigger value="dawg" class="px-4">{{ t('lab.dawgTab') }}</TabsTrigger>
        </TabsList>

        <TabsContent value="dp" class="space-y-5">
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
              class="bg-card hover:bg-accent native-text min-h-9 rounded-sm border px-3 text-sm"
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

          <!-- 動畫控制 -->
          <div class="flex flex-wrap items-center gap-2">
            <Button v-if="!playing" variant="outline" size="sm" @click="play"><PlayIcon /> {{ t('lab.play') }}</Button>
            <Button v-else variant="outline" size="sm" @click="pause"><PauseIcon /> {{ t('lab.pause') }}</Button>
            <Button variant="outline" size="sm" @click="step"><StepForwardIcon /> {{ t('lab.nextCell') }}</Button>
            <Button variant="ghost" size="sm" :disabled="!Number.isFinite(revealed)" @click="showAll"><SkipForwardIcon /> {{ t('lab.showAll') }}</Button>
            <span class="text-muted-foreground ml-auto text-xs tabular-nums">
              {{ Number.isFinite(revealed) ? `${revealed} / ${totalCells}` : t('lab.cells', { count: totalCells }) }}
            </span>
          </div>

          <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
            <DpMatrix :explanation="explanation" :revealed="revealed" :selected="selected" @select="onSelect" />
            <CellInspector v-if="selected" :explanation="explanation" :cell="selected" />
          </div>
          <p class="text-muted-foreground text-xs leading-relaxed">
            {{ t('lab.legend') }}
          </p>
        </TabsContent>

        <TabsContent value="dawg">
          <DawgExplorer :metric="metric" />
        </TabsContent>
      </Tabs>

      <aside class="min-w-0">
        <details v-if="!isDesktop" class="group rounded-xl border">
          <summary class="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 font-medium [&::-webkit-details-marker]:hidden">
            {{ t('lab.settings') }}
            <span class="text-muted-foreground text-xs transition-transform group-open:rotate-90" aria-hidden="true">▸</span>
          </summary>
          <div class="border-t p-4">
            <RuleEditor :state="state" :active-rule-count="activeRuleCount" @reset="reset" />
          </div>
        </details>
        <div v-else>
          <h2 class="mb-4 font-semibold">{{ t('lab.settings') }}</h2>
          <RuleEditor :state="state" :active-rule-count="activeRuleCount" @reset="reset" />
        </div>
      </aside>
    </div>
  </div>
</template>
