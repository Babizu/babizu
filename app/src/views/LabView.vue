<script setup>
/**
 * 演算法實驗室（docs/lab-design.md）：
 *
 * - 「動態規劃表」分頁：兩個詞的加權編輯距離，逐格播放（DpLab）
 * - 「詞圖搜尋」分頁：詞圖（DAWG）搜尋的走訪與剪枝，逐節點播放（DawgExplorer）
 * - 「構詞 BCDP」分頁：構詞搜尋怎麼找到詞根，四個面板逐步播放（MorphLab）；只在語言設定檔有構詞規格時出現
 * - 「規則與成本設定」只影響前兩個分頁；構詞分頁使用網站實際的規則與構詞規格
 *
 * 網址參數：tab；a、b（動態規劃表）；q、t（構詞）；step（播放到第幾步）。改變時以 replace 更新，不留下每一步的瀏覽紀錄。
 * 搜尋結果的「查看計算過程」與構詞說明都用這些參數連進來。
 */
import { useMediaQuery } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DawgExplorer from '@/components/lab/DawgExplorer.vue'
import DpLab from '@/components/lab/DpLab.vue'
import { createLabState } from '@/components/lab/lab-state.js'
import MorphLab from '@/components/lab/MorphLab.vue'
import RuleEditor from '@/components/lab/RuleEditor.vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { t } from '@/i18n.js'
import { COSTS, site, specLabel } from '@/lib/labels.js'

const route = useRoute()
const router = useRouter()
const { state, metric, activeRuleCount, reset } = createLabState()
/** 桌面把設定放在側欄；行動裝置收合在內容下方（只渲染一份） */
const isDesktop = useMediaQuery('(min-width: 1024px)')

const MORPHOLOGY = /** @type {any} */ (site.profile).morphology ?? null
const TABS = ['dp', 'dawg', ...(MORPHOLOGY ? ['bcdp'] : [])]
const tab = ref(TABS.includes(String(route.query.tab)) ? String(route.query.tab) : 'dp')

/** @param {unknown} v */
const stepParam = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v))
/** 各分頁的初始值（只在進入時讀一次；之後由分頁自己管理，再回寫到網址） */
const initialDp = { a: route.query.a, b: route.query.b, step: tab.value === 'dp' ? stepParam(route.query.step) : undefined }
const initialMorph = { q: route.query.q, t: route.query.t, step: tab.value === 'bcdp' ? stepParam(route.query.step) : undefined }

/** 目前分頁回報的網址參數 @type {import('vue').Ref<Record<string, unknown>>} */
const tabQuery = ref({})
/** @param {Record<string, unknown>} q */
const updateQuery = (q) => (tabQuery.value = q)
watch(tab, () => (tabQuery.value = {}))
watch([tab, tabQuery], () => {
  const entries = Object.entries({ tab: tab.value === 'dp' ? undefined : tab.value, ...tabQuery.value })
  const query = Object.fromEntries(entries.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]))
  router.replace({ query })
})

/** 構詞規格的摘要（構詞分頁的設定欄） */
const morphSummary = computed(() =>
  MORPHOLOGY
    ? /** @type {Array<[string, number]>} */ ([
        ['prefixes', MORPHOLOGY.prefixes?.length ?? 0],
        ['suffixes', MORPHOLOGY.suffixes?.length ?? 0],
        ['infixes', MORPHOLOGY.infixes?.length ?? 0],
        ['reduplication', MORPHOLOGY.reduplication?.length ?? 0],
        ['alternations', MORPHOLOGY.alternations?.length ?? 0],
      ])
    : [],
)
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
    <header class="mb-6 max-w-3xl">
      <h1 class="font-serif text-3xl font-bold tracking-tight">{{ t('演算法實驗室') }}</h1>
      <p class="text-muted-foreground mt-2 leading-relaxed">
        {{ COSTS.rule === null ? t('觀察加權編輯距離怎麼算。調整「規則與成本設定」，表格與詞圖搜尋會即時重新計算。') : t('觀察跨方言加權編輯距離怎麼算：一般的替換、刪除、插入成本較高，方言間系統性的語音對應只算 {rule}。調整「規則與成本設定」，表格與詞圖搜尋會即時重新計算。', { rule: COSTS.rule }) }}
      </p>
    </header>

    <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Tabs v-model="tab" class="min-w-0 gap-5">
        <TabsList class="scrollbar-thin h-10 max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="dp" class="px-4">{{ t('動態規劃表') }}</TabsTrigger>
          <TabsTrigger value="dawg" class="px-4">{{ t('詞圖搜尋') }}</TabsTrigger>
          <TabsTrigger v-if="MORPHOLOGY" value="bcdp" class="px-4">{{ t('構詞 BCDP') }}</TabsTrigger>
        </TabsList>

        <TabsContent value="dp">
          <DpLab :metric="metric" :initial="initialDp" @update:query="updateQuery" />
        </TabsContent>
        <TabsContent value="dawg">
          <DawgExplorer :metric="metric" />
        </TabsContent>
        <TabsContent v-if="MORPHOLOGY" value="bcdp">
          <MorphLab :initial="initialMorph" @update:query="updateQuery" />
        </TabsContent>
      </Tabs>

      <aside class="min-w-0">
        <details v-if="!isDesktop" class="group rounded-xl border">
          <summary class="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 font-medium [&::-webkit-details-marker]:hidden">
            {{ t('規則與成本設定') }}
            <span class="text-muted-foreground text-xs transition-transform group-open:rotate-90" aria-hidden="true">▸</span>
          </summary>
          <div class="border-t p-4">
            <template v-if="tab === 'bcdp'">
              <p class="text-muted-foreground mb-4 text-xs leading-relaxed">{{ t('構詞分頁使用網站實際的方言規則與構詞規格，不受左側規則設定影響（規則設定只影響前兩個分頁）。') }}</p>
              <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <template v-for="[key, count] in morphSummary" :key="key">
                  <dt class="text-muted-foreground">{{ specLabel(key) }}</dt>
                  <dd class="font-mono tabular-nums">{{ count }}</dd>
                </template>
              </dl>
            </template>
            <RuleEditor v-else :state="state" :active-rule-count="activeRuleCount" @reset="reset" />
          </div>
        </details>
        <div v-else>
          <h2 class="mb-4 font-semibold">{{ t('規則與成本設定') }}</h2>
          <template v-if="tab === 'bcdp'">
            <p class="text-muted-foreground mb-4 text-xs leading-relaxed">{{ t('構詞分頁使用網站實際的方言規則與構詞規格，不受左側規則設定影響（規則設定只影響前兩個分頁）。') }}</p>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <template v-for="[key, count] in morphSummary" :key="key">
                <dt class="text-muted-foreground">{{ specLabel(key) }}</dt>
                <dd class="font-mono tabular-nums">{{ count }}</dd>
              </template>
            </dl>
          </template>
          <RuleEditor v-else :state="state" :active-rule-count="activeRuleCount" @reset="reset" />
        </div>
      </aside>
    </div>
  </div>
</template>
