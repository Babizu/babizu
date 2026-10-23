/**
 * @file 展示版的工作台狀態：專案清單、正在編輯的專案（草稿）、檢查結果、建置、切換、匯入與匯出。
 *
 * - 瀏覽器裡可以存好幾個專案（projects.ts），網站一次顯示一個「目前的專案」最後一次建置的內容。
 * - 草稿自動存在 IndexedDB（停止輸入 400 毫秒後），重新整理不會不見；離開頁面前還沒存完就先存。
 * - 有還沒建置的變更時，關閉分頁或重新整理會先由瀏覽器詢問（瀏覽器只允許它自己的確認視窗）。
 * - 換專案、建置都會重新載入頁面：站台設定是載入時依目前的專案產生的（runtime.ts），
 *   重新載入才能確定網站、搜尋 Worker、草稿都是同一個專案，沒有上一個專案留下的狀態。
 *   重新載入之前一定先把草稿存完，而且存的是「載入時的那個專案 id」，不會寫進別的專案。
 * - 同一個瀏覽器開了幾個分頁時，以 BroadcastChannel 互相通知：別的分頁換了專案或建置時，提示重新載入。
 * - 檢查（validateProject）延遲 300 毫秒執行，打字時不會卡。
 */

import { computed, reactive, ref, shallowRef, toRaw, watch } from 'vue'
import { hasErrors, newProject, validateProject, PROJECT_FORMAT, PROJECT_VERSION, type PlaygroundProject, type ProjectIssue } from '@babizu/playground/project.ts'
import { t } from '@/i18n.ts'
import { DB } from './builder.ts'
import { isQuotaError } from './db.ts'
import { createProject, deleteProject, getDraft, loadIndex, projectTitle, saveBuilt, saveDraft, setActive, type ProjectMeta } from './projects.ts'
import { activeProjectId, builtWasInvalid, currentProject, initialProjects, loadSample } from './runtime.ts'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(toRaw(value)))

/** 目前的專案 id（頁面載入時決定；換專案會重新載入）。null：瀏覽器不允許 IndexedDB */
export const projectId = activeProjectId
/** 專案清單 */
export const projects = shallowRef<ProjectMeta[]>(initialProjects)
/** 正在編輯的專案（reactive；工作台開啟時由 IndexedDB 的草稿載入） */
export const draft = reactive<PlaygroundProject>(clone(currentProject))
/** 草稿載入完成（之前不顯示編輯畫面，免得編輯到還沒換上的內容） */
export const draftReady = ref(false)
/** 檢查結果（草稿改了之後延遲更新） */
export const issues = ref<ProjectIssue[]>([])
/** 有問題的位置（給表格標紅） */
export const issuePaths = computed(() => new Set(issues.value.flatMap((i) => i.paths ?? [i.path])))
/** 草稿與最後一次建置的內容不同 */
export const dirty = ref(false)
/** 自動存檔的狀態；error 時 saveError 是給使用者看的說明 */
export const saveState = ref<'saved' | 'pending' | 'error'>('saved')
export const saveError = ref('')
/** 別的分頁做了會影響這個分頁的事（換專案、建置、刪除），要重新載入 */
export const staleReason = ref<'' | 'active' | 'built' | 'deleted'>('')
/** 別的分頁也在編輯同一個專案 */
export const editedElsewhere = ref(false)
/** 已建置的內容有問題，網站暫時顯示空白專案 */
export const builtInvalid = builtWasInvalid
/** 工作台要跳到的位置（問題清單按「前往」；表格依此換頁、捲動） */
export const focusPath = ref<string | null>(null)

/** 重新載入之後要顯示的訊息（存在 sessionStorage） */
const FLASH_KEY = 'babizu-playground-flash'
export interface Flash {
  kind: 'success' | 'warning'
  message: string
}
export function takeFlash(): Flash | null {
  try {
    const raw = sessionStorage.getItem(FLASH_KEY)
    sessionStorage.removeItem(FLASH_KEY)
    return raw ? (JSON.parse(raw) as Flash) : null
  } catch {
    return null
  }
}
function setFlash(flash: Flash): void {
  try {
    sessionStorage.setItem(FLASH_KEY, JSON.stringify(flash))
  } catch {
    // 不能用 sessionStorage：訊息就不顯示
  }
}

const builtJson = JSON.stringify(currentProject)
/** 這個分頁的代號（BroadcastChannel 訊息分辨是不是自己送的） */
const tabId = Math.random().toString(36).slice(2)
let channel: BroadcastChannel | null = null
type ChannelMessage = { type: 'active' | 'built' | 'deleted' | 'draft' | 'list'; id: string; tab: string }
function broadcast(type: ChannelMessage['type'], id: string): void {
  channel?.postMessage({ type, id, tab: tabId } satisfies ChannelMessage)
}

/** 正在重新載入（自己發起的）：不要再問「確定離開嗎」 */
let leaving = false
let saveTimer: ReturnType<typeof setTimeout> | undefined
let saving: Promise<void> = Promise.resolve()

/** 存檔失敗的說明 */
function describeSaveError(err: unknown): string {
  if (isQuotaError(err)) return t('瀏覽器的儲存空間不夠，草稿沒有存起來。請先匯出專案檔備份，再刪掉不用的專案。')
  if (err instanceof Error && err.message === 'project-deleted') return t('這個專案已經在另一個分頁被刪除，草稿沒有存起來。請匯出專案檔保留目前的內容，再重新整理。')
  return t('草稿沒有存起來（瀏覽器不允許這個網站儲存資料，例如無痕視窗）。關閉分頁前請匯出專案檔。')
}

/** 立刻存草稿（取消等待中的自動存檔）；回傳存完的 Promise */
export function flushSave(): Promise<void> {
  clearTimeout(saveTimer)
  if (saveState.value !== 'pending') return saving
  if (!projectId) {
    saveState.value = 'error'
    saveError.value = describeSaveError(null)
    return saving
  }
  const id = projectId
  const snapshot = clone(draft)
  saving = saving
    .then(() => saveDraft(DB, id, snapshot))
    .then(() => {
      // 存的期間又改了：保持 pending，等下一次自動存檔
      if (JSON.stringify(draft) === JSON.stringify(snapshot)) saveState.value = 'saved'
      saveError.value = ''
      projects.value = projects.value.map((p) => (p.id === id ? { ...p, title: projectTitle(snapshot), words: snapshot.words.length, sentences: snapshot.sentences.length, updated: Date.now() } : p))
      broadcast('draft', id)
    })
    .catch((err) => {
      saveState.value = 'error'
      saveError.value = describeSaveError(err)
    })
  return saving
}

let started = false

/** 載入草稿並開始自動存檔、檢查（工作台第一次開啟時呼叫；重複呼叫沒有作用） */
export async function startStudio(): Promise<void> {
  if (started) return
  started = true
  if (projectId) {
    try {
      const saved = await getDraft(DB, projectId)
      if (saved?.format === PROJECT_FORMAT) replaceDraft(saved)
    } catch {
      saveState.value = 'error'
      saveError.value = describeSaveError(null)
    }
  } else {
    saveState.value = 'error'
    saveError.value = describeSaveError(null)
  }
  draftReady.value = true
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
      if (saveState.value !== 'error' || projectId) saveState.value = 'pending'
      clearTimeout(saveTimer)
      clearTimeout(checkTimer)
      saveTimer = setTimeout(flushSave, 400)
      checkTimer = setTimeout(check, 300)
    },
    { deep: true },
  )

  // 關閉分頁、重新整理：有還沒建置的變更就請瀏覽器確認；還沒存完的草稿先存
  window.addEventListener('beforeunload', (event) => {
    if (leaving) return
    if (saveState.value === 'pending') void flushSave()
    if (dirty.value || saveState.value === 'pending') {
      event.preventDefault()
      event.returnValue = ''
    }
  })
  // 切到別的分頁或縮小視窗（行動裝置可能直接關掉）：先存
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushSave()
  })

  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(DB)
    channel.addEventListener('message', (event: MessageEvent<ChannelMessage>) => {
      const m = event.data
      if (!m || m.tab === tabId) return
      if (m.type === 'draft' && m.id === projectId) editedElsewhere.value = true
      if (m.type === 'active' && m.id !== projectId) staleReason.value = 'active'
      if (m.type === 'built' && m.id === projectId) staleReason.value = 'built'
      if (m.type === 'deleted' && m.id === projectId) staleReason.value = 'deleted'
      if (m.type !== 'draft' || m.id !== projectId) void refreshProjects()
    })
  }
}

/** 重新讀專案清單 */
export async function refreshProjects(): Promise<void> {
  try {
    projects.value = (await loadIndex(DB)).projects
  } catch {
    // 讀不到就維持原來的清單
  }
}

/** 整份換掉草稿（放棄變更） */
function replaceDraft(project: PlaygroundProject): void {
  const next = clone(project)
  for (const key of Object.keys(draft) as Array<keyof PlaygroundProject>) if (!(key in next)) delete draft[key]
  Object.assign(draft, next)
}

/** 重新載入頁面（自己發起的，不再詢問）。先等草稿存完 */
async function reload(hash?: string): Promise<void> {
  await flushSave()
  leaving = true
  if (hash !== undefined) window.location.hash = hash
  window.location.reload()
}

/** 寫入失敗時丟出給使用者看的錯誤 */
function storageError(err: unknown): Error {
  if (!projectId) return new Error(t('這個瀏覽器不允許網站儲存資料（例如無痕視窗），不能存多個專案或建置自己的專案。'))
  if (isQuotaError(err)) return new Error(t('瀏覽器的儲存空間不夠。請先匯出專案檔備份，再刪掉不用的專案。'))
  if (err instanceof Error && err.message === 'project-deleted') return new Error(t('這個專案已經在另一個分頁被刪除。請重新整理。'))
  return new Error(t('瀏覽器的儲存發生錯誤：{message}', { message: err instanceof Error ? err.message : String(err) }))
}

/** 放棄變更：草稿回到最後一次建置的內容 */
export function discardChanges(): void {
  replaceDraft(currentProject)
}

/** 換目前的專案（重新載入，工作台停在專案分頁） */
export async function switchProject(id: string): Promise<void> {
  if (id === projectId) return
  try {
    await flushSave()
    await setActive(DB, id)
  } catch (err) {
    throw storageError(err)
  }
  broadcast('active', id)
  await reload()
}

/** 新增專案並換過去 */
async function addProject(project: PlaygroundProject, flash: Flash): Promise<void> {
  const ok = !hasErrors(validateProject(project))
  try {
    await flushSave()
    const meta = await createProject(DB, project, ok ? project : newProject(project.title))
    broadcast('active', meta.id)
  } catch (err) {
    throw storageError(err)
  }
  setFlash(flash)
  await reload('#/studio?tab=project')
}

export async function createBlankProject(): Promise<void> {
  await addProject(newProject(), { kind: 'success', message: t('已建立新的空白專案。') })
}

export async function createSampleProject(): Promise<void> {
  await addProject(await loadSample(), { kind: 'success', message: t('已建立範例專案。') })
}

/** 複製目前的草稿成新的專案 */
export async function duplicateProject(): Promise<void> {
  const copy = clone(draft)
  copy.title = typeof copy.title === 'string' ? t('{name}（副本）', { name: copy.title }) : Object.fromEntries(Object.entries(copy.title).map(([l, v]) => [l, l === 'en' ? `${v} (copy)` : `${v}（副本）`]))
  await addProject(copy, { kind: 'success', message: t('已複製成新的專案。') })
}

/** 刪除專案；刪的是目前的專案時換到另一個（重新載入） */
export async function removeProject(id: string): Promise<void> {
  let next: string
  try {
    if (id === projectId) clearTimeout(saveTimer)
    next = await deleteProject(DB, id, projectId)
  } catch (err) {
    throw storageError(err)
  }
  broadcast('deleted', id)
  if (next !== projectId) {
    saveState.value = 'saved'
    leaving = true
    broadcast('active', next)
    setFlash({ kind: 'success', message: t('已刪除專案。') })
    window.location.hash = '#/studio?tab=project'
    window.location.reload()
  } else await refreshProjects()
}

/** 現在的草稿可以建置（沒有 error；warning 不擋） */
export const canBuild = computed(() => !hasErrors(issues.value))

/** 建置：存成已建置的內容、回到搜尋頁、重新載入（載入時建置；見 builder.ts） */
export async function buildDraft(): Promise<void> {
  const project = clone(draft)
  const problems = validateProject(project)
  if (hasErrors(problems)) {
    issues.value = problems
    return
  }
  if (!projectId) throw storageError(null)
  try {
    clearTimeout(saveTimer)
    await saving
    await saveBuilt(DB, projectId, project)
  } catch (err) {
    throw storageError(err)
  }
  saveState.value = 'saved'
  broadcast('built', projectId)
  await reload('#/')
}

/**
 * 讀專案檔（JSON）並新增成一個專案。格式不對時丟出錯誤（訊息給使用者看）。
 * 內容有問題也照樣匯入（網站先顯示同名的空白專案），在工作台列出問題。
 */
export async function importProjectFile(file: File): Promise<void> {
  const data = await readProjectFile(file)
  const problems = validateProject(data)
  const errors = problems.filter((i) => i.level === 'error').length
  await addProject(data, errors
      ? { kind: 'warning', message: t('已匯入「{name}」，但有 {count} 個問題要修正之後才能建置（見工作台上方的清單）。', { name: file.name, count: errors }) }
      : { kind: 'success', message: t('已匯入「{name}」。按「建置」之後網站就換成這份專案。', { name: file.name }) })
}

/** 讀專案檔，檢查是不是專案（其他 Babizu 檔案說明該怎麼用） */
export async function readProjectFile(file: File): Promise<PlaygroundProject> {
  if (file.size > 200 * 1024 * 1024) throw new Error(t('「{name}」太大（{size} MB），不像是專案檔。', { name: file.name, size: Math.round(file.size / 1024 / 1024) }))
  let data: unknown
  try {
    data = JSON.parse((await file.text()).replace(/^﻿/u, ''))
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    if (/\.(csv|tsv|txt|xlsx?)$/iu.test(file.name)) throw new Error(t('「{name}」是表格，不是專案檔。要匯入詞表，請到「詞表」分頁按「匯入詞表」。', { name: file.name }))
    throw new Error(t('「{name}」不是 JSON 檔，無法當成專案檔讀取。（{detail}）', { name: file.name, detail }))
  }
  const format = data && typeof data === 'object' ? (data as { format?: unknown }).format : undefined
  if (format === 'babizu-language-profile') throw new Error(t('「{name}」是語言設定檔，不是專案檔。要套用它，請把內容貼到「進階」分頁。', { name: file.name }))
  if (format === 'babizu-dataset') throw new Error(t('「{name}」是網站的資料集設定（dataset.json），展示版不能直接讀。請匯入詞表（CSV）。', { name: file.name }))
  if (format !== PROJECT_FORMAT) throw new Error(t('「{name}」不是 Babizu 展示版的專案檔（找不到 "format": "{format}"）。', { name: file.name, format: PROJECT_FORMAT }))
  const version = (data as { version?: unknown }).version
  if (typeof version === 'number' && version > PROJECT_VERSION) throw new Error(t('「{name}」是新版的專案檔（版本 {version}），這個網站只能讀到版本 {supported}。', { name: file.name, version, supported: PROJECT_VERSION }))
  return data as PlaygroundProject
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
  return `${projectTitle(draft).replace(/[\\/:*?"<>|]+/gu, '').trim() || 'project'}${suffix}`
}

/** 匯出專案檔 */
export function exportProject(): void {
  download(projectFileName('.babizu.json'), `${JSON.stringify(clone(draft), null, 2)}\n`, 'application/json')
}
