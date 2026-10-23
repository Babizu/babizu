/**
 * @file 展示版的執行期站台設定：在前端其他程式載入之前，由瀏覽器裡的專案產生 `virtual:babizu/site`。
 *
 * 展示版的 `virtual:babizu/site` 是 `export default await loadPlaygroundSite(建置時的設定)`（src/site/vite.ts）：
 * 引用站台設定的模組都在它之後才執行，所以它們照常把站台設定當常數用。換專案、按「建置」之後重新載入頁面。
 *
 * 這個檔不能引用 `virtual:babizu/site`（它自己就是在產生那個模組）。
 */

import type { ClientSite } from '@babizu/site/client.ts'
import { varietyCss } from '@babizu/site/varieties.ts'
import { hasErrors, newProject, validateProject, type PlaygroundProject } from '@babizu/playground/project.ts'
import { playgroundClientSite } from '@babizu/playground/site.ts'
import { dbName } from './db.ts'
import { createProject, getBuilt, loadIndex, projectTitle, type ProjectMeta } from './projects.ts'

/** 目前載入的專案（最後一次建置的內容；第一次開啟時是範例專案） */
export let currentProject: PlaygroundProject

/** 目前的專案 id；瀏覽器不允許 IndexedDB 時是 null（專案只在這次開啟有效） */
export let activeProjectId: string | null = null

/** 頁面載入時的專案清單 */
export let initialProjects: ProjectMeta[] = []

/** 已建置的內容有問題（例如舊版的格式）而改顯示空白專案 */
export let builtWasInvalid = false

/** 建置時的站台設定（工作台「載入範例」用：範例專案的網址等） */
export let baseSite: ClientSite

/** 範例專案的網址 */
export function sampleUrl(): string {
  return `${import.meta.env.BASE_URL}playground/sample.json`
}

/** 讀範例專案 */
export async function loadSample(): Promise<PlaygroundProject> {
  const res = await fetch(sampleUrl())
  if (!res.ok) throw new Error(`Cannot load the sample project (HTTP ${res.status})`)
  return res.json()
}

/** 目前的專案：清單上記的那個，沒有就是最近修改的；一個都沒有時以範例專案建立第一個 */
async function loadActive(db: string): Promise<PlaygroundProject> {
  const index = await loadIndex(db)
  const id = index.projects.some((p) => p.id === index.active) ? index.active : ([...index.projects].sort((a, b) => b.updated - a.updated)[0]?.id ?? null)
  if (!id) {
    const sample = await loadSample()
    const meta = await createProject(db, sample)
    initialProjects = [meta]
    activeProjectId = meta.id
    return sample
  }
  initialProjects = index.projects
  activeProjectId = id
  const built = await getBuilt(db, id)
  if (built && !hasErrors(validateProject(built))) return built
  // 沒有建置過或內容有問題：網站先顯示同名的空白專案，工作台的草稿不受影響
  builtWasInvalid = !!built
  const title = index.projects.find((p) => p.id === id)?.title ?? projectTitle({ title: '' })
  return newProject({ 'zh-TW': title, en: title })
}

export async function loadPlaygroundSite(base: ClientSite): Promise<ClientSite> {
  baseSite = base
  try {
    currentProject = await loadActive(dbName(base.id))
  } catch {
    // 瀏覽器不允許 IndexedDB（例如某些隱私模式）：每次都從範例開始
    activeProjectId = null
    currentProject = await loadSample()
  }
  const site = playgroundClientSite(base, currentProject)
  // index.html 的變體顏色與標題是建置時寫的；展示版依專案在這裡補上
  const style = document.createElement('style')
  style.id = 'babizu-varieties'
  style.textContent = varietyCss(site.varieties)
  document.head.append(style)
  document.title = site.title[site.defaultLocale] ?? document.title
  return site
}
