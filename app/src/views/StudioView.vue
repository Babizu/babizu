<script setup lang="ts">
/**
 * 展示版的工作台（docs/playground.md）：編輯專案（詞表、例句、語言變體、方言規則、構詞），按「建置」之後整個網站換成這份專案。
 *
 * 分頁：專案、詞表、方言規則、構詞、進階（整份語言設定檔的 JSON）。網址參數 tab 記住分頁。
 * 編輯的是草稿（自動存在瀏覽器裡）；網站顯示的是最後一次建置的專案。狀態與動作在 playground/studio.ts。
 */
import { AlertTriangleIcon, HammerIcon, Undo2Icon } from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdvancedPanel from '@/components/studio/AdvancedPanel.vue'
import MorphologyPanel from '@/components/studio/MorphologyPanel.vue'
import ProjectPanel from '@/components/studio/ProjectPanel.vue'
import RulesPanel from '@/components/studio/RulesPanel.vue'
import WordsPanel from '@/components/studio/WordsPanel.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { t } from '@/i18n.ts'
import { buildDraft, canBuild, dirty, discardChanges, draftReady, issues, startStudio } from '@/playground/studio.ts'

const route = useRoute()
const router = useRouter()
const TABS = ['project', 'words', 'rules', 'morphology', 'advanced'] as const
const tab = ref<string>(TABS.includes(route.query.tab as (typeof TABS)[number]) ? String(route.query.tab) : 'words')
watch(tab, (value) => router.replace({ query: value === 'words' ? {} : { tab: value } }))
// 同一頁換網址參數（例如從別處連到 ?tab=rules）時也切換
watch(
  () => route.query.tab,
  (value) => {
    const next = TABS.includes(value as (typeof TABS)[number]) ? String(value) : 'words'
    if (next !== tab.value) tab.value = next
  },
)

const building = ref(false)
async function build() {
  building.value = true
  try {
    await buildDraft()
  } finally {
    building.value = false
  }
}
/** 問題依分頁分組（分頁標籤上顯示數字） */
const issuesByTab = computed(() => {
  const count = { project: 0, words: 0, rules: 0, morphology: 0, advanced: 0 }
  for (const i of issues.value) {
    if (i.path.startsWith('words') || i.path.startsWith('sentences')) count.words++
    else if (i.path.startsWith('profile')) count.advanced++
    else count.project++
  }
  return count
})

onMounted(() => startStudio())
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
    <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div class="max-w-3xl min-w-0 flex-[1_1_18rem]">
        <h1 class="font-serif text-3xl font-bold tracking-tight">{{ t('工作台') }}</h1>
        <p class="text-muted-foreground mt-2 leading-relaxed">
          {{ t('編輯詞表、語言變體、方言規則與構詞，按「建置」之後整個網站（搜尋、詞條、實驗室）就換成這份專案。資料只存在這個瀏覽器裡。') }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Badge v-if="draftReady" :variant="dirty ? 'soft' : 'quiet'" size="tag">{{ dirty ? t('有還沒建置的變更') : t('已建置') }}</Badge>
        <Button v-if="dirty" variant="ghost" size="sm" @click="discardChanges">
          <Undo2Icon />
          {{ t('放棄變更') }}
        </Button>
        <Button size="sm" :disabled="!canBuild || building" @click="build">
          <HammerIcon />
          {{ t('建置') }}
        </Button>
      </div>
    </header>

    <div v-if="issues.length" role="status" class="border-destructive/40 bg-destructive/5 mb-6 rounded-lg border p-3 text-sm">
      <p class="flex items-center gap-2 font-medium">
        <AlertTriangleIcon class="text-destructive size-4 shrink-0" aria-hidden="true" />
        {{ t('有 {count} 個問題，修正之後才能建置', { count: issues.length }) }}
      </p>
      <ul class="text-muted-foreground mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-6 text-xs">
        <li v-for="(issue, k) in issues.slice(0, 50)" :key="k">{{ issue.message }}</li>
      </ul>
    </div>

    <Tabs v-model="tab" class="min-w-0 gap-5">
      <TabsList class="scrollbar-thin h-10 max-w-full justify-start overflow-x-auto">
        <TabsTrigger value="project" class="px-4">{{ t('專案') }}<span v-if="issuesByTab.project" class="text-destructive ml-1 tabular-nums">{{ issuesByTab.project }}</span></TabsTrigger>
        <TabsTrigger value="words" class="px-4">{{ t('詞表') }}<span v-if="issuesByTab.words" class="text-destructive ml-1 tabular-nums">{{ issuesByTab.words }}</span></TabsTrigger>
        <TabsTrigger value="rules" class="px-4">{{ t('方言規則') }}</TabsTrigger>
        <TabsTrigger value="morphology" class="px-4">{{ t('構詞') }}</TabsTrigger>
        <TabsTrigger value="advanced" class="px-4">{{ t('進階') }}<span v-if="issuesByTab.advanced" class="text-destructive ml-1 tabular-nums">{{ issuesByTab.advanced }}</span></TabsTrigger>
      </TabsList>
      <TabsContent value="project" class="min-w-0"><ProjectPanel /></TabsContent>
      <TabsContent value="words" class="min-w-0"><WordsPanel /></TabsContent>
      <TabsContent value="rules" class="min-w-0"><RulesPanel /></TabsContent>
      <TabsContent value="morphology" class="min-w-0"><MorphologyPanel /></TabsContent>
      <TabsContent value="advanced" class="min-w-0"><AdvancedPanel /></TabsContent>
    </Tabs>
  </div>
</template>
