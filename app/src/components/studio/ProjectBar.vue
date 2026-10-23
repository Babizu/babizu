<script setup lang="ts">
/**
 * 工作台頂端的專案列：切換專案、新增（空白、範例、複製）、匯入與匯出專案檔、匯出網站起始包、刪除。
 * 換專案、新增、匯入都會重新載入頁面（見 playground/studio.ts）；草稿先存好，不會遺失。
 */
import { CopyIcon, DownloadIcon, FilePlusIcon, ImportIcon, SparklesIcon, Trash2Icon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n.ts'
import { askConfirm } from '@/playground/confirm.ts'
import {
  createBlankProject,
  createSampleProject,
  dirty,
  duplicateProject,
  exportProject,
  importProjectFile,
  projectId,
  projects,
  removeProject,
  switchProject,
} from '@/playground/studio.ts'
import ExportSiteButton from './ExportSiteButton.vue'

const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const sorted = computed(() => [...projects.value].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hant') || a.updated - b.updated))
const current = computed(() => projects.value.find((p) => p.id === projectId))
/** 不能用 IndexedDB 時只有這一個專案 */
const storable = projectId !== null

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })

/** 執行會重新載入頁面的動作；失敗時顯示原因 */
async function run(action: () => Promise<void>) {
  busy.value = true
  try {
    await action()
  } catch (err) {
    toast.error((err as Error).message)
    busy.value = false
  }
}

/** 有還沒建置的變更時先說明：草稿會留在原本的專案裡 */
async function leaveOk(title: string, confirm: string): Promise<boolean> {
  if (!dirty.value) return true
  return askConfirm({
    title,
    message: t('「{name}」有還沒建置的變更。草稿會保留在這個專案裡，之後切換回來可以繼續編輯或建置；網站在那之前顯示的是它上一次建置的內容。', { name: current.value?.title ?? '' }),
    confirm,
  })
}

async function onSwitch(event: Event) {
  const select = event.target as HTMLSelectElement
  const id = select.value
  if (!(await leaveOk(t('切換專案'), t('切換')))) {
    select.value = projectId ?? ''
    return
  }
  await run(() => switchProject(id))
}
async function onNew() {
  if (await leaveOk(t('新增空白專案'), t('新增'))) await run(createBlankProject)
}
async function onSample() {
  if (await leaveOk(t('新增範例專案'), t('新增'))) await run(createSampleProject)
}
async function onDuplicate() {
  if (await leaveOk(t('複製專案'), t('複製'))) await run(duplicateProject)
}
async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (fileInput.value) fileInput.value.value = ''
  if (file && (await leaveOk(t('匯入專案檔'), t('匯入')))) await run(() => importProjectFile(file))
}
async function onDelete() {
  const name = current.value?.title ?? ''
  const ok = await askConfirm({
    title: t('刪除專案「{name}」？', { name }),
    message:
      projects.value.length > 1
        ? t('這個專案的詞表、規則與構詞都會從這個瀏覽器刪除，無法復原。要保留，請先「匯出專案檔」。刪除之後換到另一個專案。')
        : t('這個專案的詞表、規則與構詞都會從這個瀏覽器刪除，無法復原。要保留，請先「匯出專案檔」。這是唯一的專案，刪除之後會換成新的空白專案。'),
    confirm: t('刪除'),
    destructive: true,
  })
  if (ok && projectId) await run(() => removeProject(projectId as string))
}
</script>

<template>
  <section class="bg-muted/30 space-y-3 rounded-xl border p-3 sm:p-4" :aria-label="t('專案')">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <label for="studio-project" class="text-sm font-medium">{{ t('目前的專案') }}</label>
      <select
        id="studio-project"
        class="border-input bg-background h-9 max-w-full min-w-0 flex-[1_1_16rem] rounded-md border px-2 text-sm sm:max-w-md"
        :value="projectId ?? ''"
        :disabled="busy || !storable"
        @change="onSwitch"
      >
        <option v-if="!storable" value="">{{ t('（這個瀏覽器不能儲存專案）') }}</option>
        <option v-for="p in sorted" :key="p.id" :value="p.id">
          {{ t('{name}（{words} 個詞，{date}）', { name: p.title, words: p.words, date: dateFormat.format(p.updated) }) }}
        </option>
      </select>
      <span class="text-muted-foreground text-xs tabular-nums">{{ t('瀏覽器裡共 {count} 個專案', { count: projects.length }) }}</span>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" :disabled="busy || !storable" @click="onNew"><FilePlusIcon />{{ t('新的空白專案') }}</Button>
      <Button variant="outline" size="sm" :disabled="busy || !storable" @click="onSample"><SparklesIcon />{{ t('新增範例專案') }}</Button>
      <Button variant="outline" size="sm" :disabled="busy || !storable" @click="onDuplicate"><CopyIcon />{{ t('複製這個專案') }}</Button>
      <span class="bg-border mx-1 hidden w-px self-stretch sm:block" aria-hidden="true" />
      <Button variant="outline" size="sm" :disabled="busy || !storable" @click="fileInput?.click()"><ImportIcon />{{ t('匯入專案檔') }}</Button>
      <input ref="fileInput" type="file" accept=".json,application/json" class="hidden" :aria-label="t('匯入專案檔')" @change="onFile" />
      <Button variant="outline" size="sm" @click="exportProject"><DownloadIcon />{{ t('匯出專案檔') }}</Button>
      <ExportSiteButton />
      <Button variant="ghost" size="sm" class="text-destructive hover:text-destructive sm:ml-auto" :disabled="busy || !storable" @click="onDelete"><Trash2Icon />{{ t('刪除這個專案') }}</Button>
    </div>
    <p class="text-muted-foreground text-xs leading-relaxed">
      {{ t('專案只存在這個瀏覽器裡。要換電腦、給別人，或怕清掉瀏覽器資料，請匯出專案檔；之後可以再匯入。') }}
    </p>
  </section>
</template>
