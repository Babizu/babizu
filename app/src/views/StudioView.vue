<script setup lang="ts">
/**
 * 展示版的工作台（docs/playground.md）：編輯專案（詞表、例句、語言變體、方言規則、構詞），按「建置」之後整個網站換成這份專案。
 *
 * 頂端是專案列（切換、新增、匯入、匯出）；分頁：專案、詞表、方言規則、構詞、進階（整份語言設定檔的 JSON）。網址參數 tab 記住分頁。
 * 編輯的是草稿（自動存在瀏覽器裡）；網站顯示的是最後一次建置的內容。狀態與動作在 playground/studio.ts。
 * 問題清單依分頁分組，按一下跳到出問題的那一列。
 */
import { AlertTriangleIcon, CheckIcon, CloudOffIcon, HammerIcon, InfoIcon, LoaderIcon, RefreshCwIcon, Undo2Icon } from '@lucide/vue'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import AdvancedPanel from '@/components/studio/AdvancedPanel.vue'
import ConfirmDialog from '@/components/studio/ConfirmDialog.vue'
import MorphologyPanel from '@/components/studio/MorphologyPanel.vue'
import ProjectBar from '@/components/studio/ProjectBar.vue'
import ProjectPanel from '@/components/studio/ProjectPanel.vue'
import RulesPanel from '@/components/studio/RulesPanel.vue'
import WordsPanel from '@/components/studio/WordsPanel.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { msg, t } from '@/i18n.ts'
import { askConfirm } from '@/playground/confirm.ts'
import {
  buildDraft,
  builtInvalid,
  canBuild,
  dirty,
  discardChanges,
  draftReady,
  editedElsewhere,
  focusPath,
  issues,
  saveError,
  saveState,
  staleReason,
  startStudio,
  takeFlash,
} from '@/playground/studio.ts'
import type { ProjectIssue } from '@babizu/playground/project.ts'

const route = useRoute()
const router = useRouter()
const TABS = ['project', 'words', 'rules', 'morphology', 'advanced'] as const
type Tab = (typeof TABS)[number]
const tab = ref<string>(TABS.includes(route.query.tab as Tab) ? String(route.query.tab) : 'words')
watch(tab, (value) => router.replace({ query: value === 'words' ? {} : { tab: value } }))
// 同一頁換網址參數（例如從別處連到 ?tab=rules）時也切換
watch(
  () => route.query.tab,
  (value) => {
    const next = TABS.includes(value as Tab) ? String(value) : 'words'
    if (next !== tab.value) tab.value = next
  },
)

const TAB_LABELS: Record<Tab, string> = { project: msg('專案'), words: msg('詞表'), rules: msg('方言規則'), morphology: msg('構詞'), advanced: msg('進階') }

/** 問題在哪個分頁 */
function tabOf(issue: ProjectIssue): Tab {
  const p = issue.path
  if (p.startsWith('words') || p.startsWith('sentences')) return 'words'
  if (p.startsWith('profile.rules') || p.startsWith('profile.normalizer') || p.startsWith('profile.costs')) return 'rules'
  if (p.startsWith('profile.morphology')) {
    return /^profile\.morphology\.(prefixes|suffixes|infixes|alternations|reduplication)\[/u.test(p) ? 'morphology' : 'advanced'
  }
  if (p.startsWith('profile')) return 'advanced'
  return 'project'
}
/** 問題的參數裡，這些是介面字串（「詞表」「前綴」…）：依語系翻譯 */
const LABEL_PARAMS = new Set(['list', 'text', 'kind', 'name'])
function issueText(issue: ProjectIssue): string {
  const params = Object.fromEntries(Object.entries(issue.params ?? {}).map(([k, v]) => [k, LABEL_PARAMS.has(k) && typeof v === 'string' ? t(v) : v]))
  return t(issue.key, params)
}
const errorCount = computed(() => issues.value.filter((i) => i.level === 'error').length)
const warningCount = computed(() => issues.value.length - errorCount.value)
/** 問題依分頁分組（錯誤在前） */
const groups = computed(() =>
  TABS.map((key) => ({ key, items: issues.value.filter((i) => tabOf(i) === key).sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1)) })).filter((g) => g.items.length),
)
const countOn = (key: Tab) => issues.value.filter((i) => i.level === 'error' && tabOf(i) === key).length
const showAll = ref(false)
const SHOWN = 6

/** 跳到出問題的位置：換分頁、（詞表）翻頁，再捲過去並聚焦第一個輸入框 */
async function goTo(issue: ProjectIssue) {
  tab.value = tabOf(issue)
  focusPath.value = null
  await nextTick()
  focusPath.value = issue.path
  // 等表格換頁、重新畫好
  await nextTick()
  await nextTick()
  // 由完整路徑往上找有標 data-path 的元素（words[3].text → words[3]）
  let path = issue.path
  let el: HTMLElement | null = null
  while (path && !(el = document.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`))) path = path.replace(/(\.\w+|\[\d+\])$/u, '') === path ? '' : path.replace(/(\.\w+|\[\d+\])$/u, '')
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.querySelector<HTMLElement>('[aria-invalid="true"], input, select, textarea')?.focus({ preventScroll: true })
}

const building = ref(false)
async function build() {
  building.value = true
  try {
    await buildDraft()
  } catch (err) {
    toast.error((err as Error).message)
  } finally {
    building.value = false
  }
}
async function discard() {
  const ok = await askConfirm({
    title: t('放棄還沒建置的變更？'),
    message: t('草稿會回到上一次建置的內容，之後的修改（詞表、規則、構詞…）都會消失，無法復原。'),
    confirm: t('放棄變更'),
    destructive: true,
  })
  if (ok) discardChanges()
}
function reloadPage() {
  window.location.reload()
}

onMounted(async () => {
  await startStudio()
  const flash = takeFlash()
  if (flash) (flash.kind === 'warning' ? toast.warning : toast.success)(flash.message)
})
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
    <header class="mb-4 flex flex-wrap items-start justify-between gap-4">
      <div class="max-w-3xl min-w-0 flex-[1_1_18rem]">
        <h1 class="font-serif text-3xl font-bold tracking-tight">{{ t('工作台') }}</h1>
        <p class="text-muted-foreground mt-2 leading-relaxed">
          {{ t('編輯詞表、語言變體、方言規則與構詞，按「建置」之後整個網站（搜尋、詞條、實驗室）就換成這份專案。資料只存在這個瀏覽器裡。') }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="draftReady" class="text-muted-foreground flex items-center gap-1 text-xs" role="status" aria-live="polite">
          <template v-if="saveState === 'pending'"><LoaderIcon class="size-3.5 animate-spin" aria-hidden="true" />{{ t('儲存中…') }}</template>
          <template v-else-if="saveState === 'saved'"><CheckIcon class="size-3.5" aria-hidden="true" />{{ t('草稿已儲存') }}</template>
          <template v-else><CloudOffIcon class="text-destructive size-3.5" aria-hidden="true" />{{ t('草稿沒有儲存') }}</template>
        </span>
        <Badge v-if="draftReady" :variant="dirty ? 'soft' : 'quiet'" size="tag">{{ dirty ? t('有還沒建置的變更') : t('已建置') }}</Badge>
        <Button v-if="dirty" variant="ghost" size="sm" @click="discard">
          <Undo2Icon />
          {{ t('放棄變更') }}
        </Button>
        <Button size="sm" :disabled="!draftReady || !canBuild || building" :title="canBuild ? undefined : t('先修正下面列出的錯誤')" @click="build">
          <HammerIcon />
          {{ t('建置') }}
        </Button>
      </div>
    </header>

    <div v-if="staleReason" role="alert" class="border-primary/40 bg-primary/5 mb-4 flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
      <InfoIcon class="text-primary size-4 shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1">
        {{ staleReason === 'active' ? t('另一個分頁換了目前的專案。這個分頁顯示的是舊的狀態，請重新載入。') : staleReason === 'built' ? t('這個專案在另一個分頁建置了。請重新載入，看到最新的內容。') : t('這個專案在另一個分頁被刪除了。請先匯出專案檔保留目前的內容，再重新載入。') }}
      </span>
      <Button size="sm" variant="outline" @click="reloadPage"><RefreshCwIcon />{{ t('重新載入') }}</Button>
    </div>
    <p v-else-if="editedElsewhere" role="status" class="border-border bg-muted/40 mb-4 rounded-lg border p-3 text-sm">
      {{ t('這個專案也在另一個分頁編輯中。兩邊的修改會互相覆蓋，請只在一個分頁編輯。') }}
    </p>
    <p v-if="saveState === 'error' && saveError" role="alert" class="border-destructive/40 bg-destructive/5 mb-4 rounded-lg border p-3 text-sm">{{ saveError }}</p>
    <p v-if="builtInvalid" role="status" class="border-border bg-muted/40 mb-4 rounded-lg border p-3 text-sm">
      {{ t('這個專案上一次建置的內容無法使用（可能是舊版的格式），網站暫時顯示空白的辭典。修正下面的問題之後按「建置」。') }}
    </p>

    <ProjectBar class="mb-6" />

    <div v-if="issues.length" class="mb-6 rounded-lg border p-3 text-sm" :class="errorCount ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/30'">
      <p class="flex items-center gap-2 font-medium" role="status">
        <AlertTriangleIcon class="size-4 shrink-0" :class="errorCount ? 'text-destructive' : 'text-muted-foreground'" aria-hidden="true" />
        <template v-if="errorCount">{{ t('有 {count} 個問題，修正之後才能建置', { count: errorCount }) }}</template>
        <template v-if="warningCount">{{ errorCount ? t('（另有 {count} 個提醒）', { count: warningCount }) : t('有 {count} 個提醒（不影響建置）', { count: warningCount }) }}</template>
      </p>
      <div v-for="g in groups" :key="g.key" class="mt-3">
        <p class="text-muted-foreground text-xs font-medium">{{ t(TAB_LABELS[g.key]) }}</p>
        <ul class="mt-1 space-y-1">
          <li v-for="(issue, k) in showAll ? g.items : g.items.slice(0, SHOWN)" :key="k" class="flex items-start gap-2">
            <span class="mt-1.5 size-1.5 shrink-0 rounded-full" :class="issue.level === 'error' ? 'bg-destructive' : 'bg-muted-foreground/60'" aria-hidden="true" />
            <span class="min-w-0 flex-1 leading-relaxed">
              <span v-if="issue.level === 'warning'" class="text-muted-foreground">{{ t('提醒：') }}</span>{{ issueText(issue) }}
            </span>
            <button type="button" class="text-primary shrink-0 text-xs underline-offset-4 hover:underline" @click="goTo(issue)">{{ t('前往') }}</button>
          </li>
        </ul>
        <button v-if="!showAll && g.items.length > SHOWN" type="button" class="text-primary mt-1 text-xs underline-offset-4 hover:underline" @click="showAll = true">
          {{ t('顯示其他 {count} 個', { count: g.items.length - SHOWN }) }}
        </button>
      </div>
    </div>

    <Tabs v-if="draftReady" v-model="tab" class="min-w-0 gap-5">
      <TabsList class="scrollbar-thin h-10 max-w-full justify-start overflow-x-auto">
        <TabsTrigger v-for="key in TABS" :key="key" :value="key" class="px-4">
          {{ t(TAB_LABELS[key]) }}<span v-if="countOn(key)" class="text-destructive ml-1 tabular-nums">{{ countOn(key) }}</span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="project" class="min-w-0"><ProjectPanel /></TabsContent>
      <TabsContent value="words" class="min-w-0"><WordsPanel /></TabsContent>
      <TabsContent value="rules" class="min-w-0"><RulesPanel /></TabsContent>
      <TabsContent value="morphology" class="min-w-0"><MorphologyPanel /></TabsContent>
      <TabsContent value="advanced" class="min-w-0"><AdvancedPanel /></TabsContent>
    </Tabs>
    <p v-else class="text-muted-foreground flex items-center gap-2 text-sm"><LoaderIcon class="size-4 animate-spin" aria-hidden="true" />{{ t('載入草稿…') }}</p>
    <ConfirmDialog />
  </div>
</template>
