/**
 * @file 展示版的工作台狀態：正在編輯的專案（草稿）、檢查結果、建置、匯入與匯出。
 *
 * - 草稿自動存在 IndexedDB（kv 'draft'），重新整理不會不見；網站顯示的是最後一次建置的專案（kv 'current'）。
 * - 「建置」：檢查草稿 → 存成 current → 重新載入頁面（載入時依 current 在 Web Worker 裡建置，見 builder.ts）。
 * - 檢查（validateProject）延遲 300 毫秒執行，打字時不會卡。
 */

import { computed, reactive, ref, toRaw, watch } from 'vue'
import { newProject, validateProject, PROJECT_FORMAT, type PlaygroundProject, type ProjectIssue } from '@babizu/playground/project.ts'
import { DB } from './builder.ts'
import { kvGet, kvSet } from './db.ts'
import { currentProject, loadSample } from './runtime.ts'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(toRaw(value)))

/** 正在編輯的專案（reactive；第一次用到時由 IndexedDB 的草稿或目前的專案載入） */
export const draft = reactive<PlaygroundProject>(clone(currentProject))
/** 草稿載入完成 */
export const draftReady = ref(false)
/** 檢查結果（草稿改了之後延遲更新） */
export const issues = ref<ProjectIssue[]>([])
/** 草稿與最後一次建置的專案不同 */
export const dirty = ref(false)

const builtJson = JSON.stringify(currentProject)
let started = false

/** 載入草稿並開始自動存檔、檢查（工作台第一次開啟時呼叫；重複呼叫沒有作用） */
export async function startStudio(): Promise<void> {
  if (started) return
  started = true
  try {
    const saved = await kvGet<PlaygroundProject>(DB, 'draft')
    if (saved?.format === PROJECT_FORMAT) replaceDraft(saved)
  } catch {
    // 沒有 IndexedDB：草稿只在這次開啟有效
  }
  draftReady.value = true
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let checkTimer: ReturnType<typeof setTimeout> | undefined
  const check = () => {
    const json = JSON.stringify(draft)
    dirty.value = json !== builtJson
    issues.value = validateProject(JSON.parse(json))
  }
  check()
  watch(
    draft,
    () => {
      clearTimeout(saveTimer)
      clearTimeout(checkTimer)
      saveTimer = setTimeout(() => kvSet(DB, 'draft', clone(draft)).catch(() => {}), 500)
      checkTimer = setTimeout(check, 300)
    },
    { deep: true },
  )
}

/** 整份換掉草稿（新專案、載入範例、匯入） */
export function replaceDraft(project: PlaygroundProject): void {
  const next = clone(project)
  for (const key of Object.keys(draft) as Array<keyof PlaygroundProject>) if (!(key in next)) delete draft[key]
  Object.assign(draft, next)
}

/** 放棄變更：草稿回到最後一次建置的專案 */
export function discardChanges(): void {
  replaceDraft(currentProject)
}

export function startNewProject(): void {
  replaceDraft(newProject())
}

export async function loadSampleProject(): Promise<void> {
  replaceDraft(await loadSample())
}

/** 現在的草稿可以建置 */
export const canBuild = computed(() => issues.value.length === 0)

/** 建置：存成目前的專案、回到搜尋頁、重新載入（載入時建置；見 builder.ts） */
export async function buildDraft(): Promise<void> {
  const project = clone(draft)
  const problems = validateProject(project)
  if (problems.length) {
    issues.value = problems
    return
  }
  await kvSet(DB, 'current', project)
  await kvSet(DB, 'draft', project)
  window.location.hash = '#/'
  window.location.reload()
}

/** 匯入專案檔（JSON）。格式不對時丟出錯誤（訊息給使用者看） */
export async function importProjectFile(file: File): Promise<void> {
  let data: unknown
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error('not-json')
  }
  if (!data || typeof data !== 'object' || (data as { format?: string }).format !== PROJECT_FORMAT) throw new Error('not-project')
  replaceDraft(data as PlaygroundProject)
}

/** 下載一個檔案 */
export function download(name: string, content: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 檔名：專案名稱（去掉不能用在檔名的字元） */
export function projectFileName(suffix: string): string {
  const title = typeof draft.title === 'string' ? draft.title : (Object.values(draft.title)[0] ?? 'project')
  return `${title.replace(/[\\/:*?"<>|]+/gu, '').trim() || 'project'}${suffix}`
}

/** 匯出專案檔 */
export function exportProject(): void {
  download(projectFileName('.babizu.json'), `${JSON.stringify(clone(draft), null, 2)}\n`, 'application/json')
}
