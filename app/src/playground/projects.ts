/**
 * @file 展示版的專案清單：瀏覽器裡可以存好幾個專案，一次顯示其中一個（「目前的專案」）。
 *
 * IndexedDB 的 kv 裡：
 * - 'projects'：專案清單（ProjectMeta[]，只有名稱、筆數等，列清單時不必讀整份專案）；
 * - 'active'：目前的專案 id；
 * - 'draft:<id>'：工作台正在編輯的內容（自動存檔）；
 * - 'built:<id>'：最後一次建置的內容（網站顯示的就是它）。
 * 清單與內容在同一個交易裡更新（db.ts 的 kvUpdate），清單不會指向不存在的內容。
 *
 * 舊版只存一個專案（'current'、'draft'）：第一次讀清單時轉成一個專案。
 */

import { newProject, type PlaygroundProject } from '@babizu/playground/project.ts'
import { localize } from '@babizu/site/varieties.ts'
import { kvGet, kvUpdate } from './db.ts'

export interface ProjectMeta {
  id: string
  /** 辭典名稱（預設語系的；給清單顯示） */
  title: string
  words: number
  sentences: number
  /** 草稿最後修改的時間（毫秒） */
  updated: number
  /** 最後一次建置的時間；沒建置過是 null */
  built: number | null
}

const draftKey = (id: string) => `draft:${id}`
const builtKey = (id: string) => `built:${id}`

/** 專案名稱（清單、檔名用） */
export function projectTitle(project: Pick<PlaygroundProject, 'title'>, locale = 'zh-TW'): string {
  const title = typeof project.title === 'string' ? project.title : (localize(project.title, [locale], locale)?.[locale] ?? Object.values(project.title ?? {})[0])
  return title?.trim() || '未命名的辭典'
}

function metaOf(id: string, project: PlaygroundProject, built: number | null): ProjectMeta {
  return {
    id,
    title: projectTitle(project),
    words: Array.isArray(project.words) ? project.words.length : 0,
    sentences: Array.isArray(project.sentences) ? project.sentences.length : 0,
    updated: Date.now(),
    built,
  }
}

function newId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 專案清單與目前的專案 id（舊版的單一專案在這裡轉換） */
export async function loadIndex(db: string): Promise<{ projects: ProjectMeta[]; active: string | null }> {
  let projects = await kvGet<ProjectMeta[]>(db, 'projects')
  if (!projects) {
    const legacyBuilt = await kvGet<PlaygroundProject>(db, 'current')
    const legacyDraft = await kvGet<PlaygroundProject>(db, 'draft')
    projects = []
    if (legacyBuilt || legacyDraft) {
      const id = newId()
      const built = legacyBuilt ?? legacyDraft
      const draft = legacyDraft ?? legacyBuilt
      projects = await kvUpdate<ProjectMeta[]>(db, 'projects', (list = []) => [...list, metaOf(id, draft as PlaygroundProject, Date.now())], { [draftKey(id)]: draft, [builtKey(id)]: built, active: id }, ['current', 'draft', 'build'])
    }
  }
  return { projects, active: (await kvGet<string>(db, 'active')) ?? null }
}

export async function getDraft(db: string, id: string): Promise<PlaygroundProject | undefined> {
  return kvGet<PlaygroundProject>(db, draftKey(id))
}

export async function getBuilt(db: string, id: string): Promise<PlaygroundProject | undefined> {
  return kvGet<PlaygroundProject>(db, builtKey(id))
}

/**
 * 新增一個專案並設為目前的專案。
 * @param built 網站要顯示的內容；省略時與草稿相同（草稿要能建置），或傳入同名的空白專案（草稿有問題時）
 */
export async function createProject(db: string, draft: PlaygroundProject, built: PlaygroundProject = draft): Promise<ProjectMeta> {
  const id = newId()
  const meta = metaOf(id, draft, Date.now())
  await kvUpdate<ProjectMeta[]>(db, 'projects', (list = []) => [...list, meta], { [draftKey(id)]: draft, [builtKey(id)]: built, active: id })
  return meta
}

/** 存草稿（清單上的名稱與筆數一起更新）。專案已經被刪掉（例如在另一個分頁）時丟出錯誤 */
export async function saveDraft(db: string, id: string, draft: PlaygroundProject): Promise<void> {
  await kvUpdate<ProjectMeta[]>(
    db,
    'projects',
    (list = []) => {
      const old = list.find((p) => p.id === id)
      if (!old) throw new Error('project-deleted')
      return list.map((p) => (p.id === id ? { ...metaOf(id, draft, old.built) } : p))
    },
    { [draftKey(id)]: draft },
  )
}

/** 建置：草稿存成已建置的內容，並設為目前的專案 */
export async function saveBuilt(db: string, id: string, project: PlaygroundProject): Promise<void> {
  await kvUpdate<ProjectMeta[]>(
    db,
    'projects',
    (list = []) => {
      if (!list.some((p) => p.id === id)) throw new Error('project-deleted')
      return list.map((p) => (p.id === id ? metaOf(id, project, Date.now()) : p))
    },
    { [draftKey(id)]: project, [builtKey(id)]: project, active: id },
  )
}

/** 換目前的專案 */
export async function setActive(db: string, id: string): Promise<void> {
  await kvUpdate<ProjectMeta[]>(db, 'projects', (list = []) => {
    if (!list.some((p) => p.id === id)) throw new Error('project-deleted')
    return list
  }, { active: id })
}

/**
 * 刪除一個專案。刪的是目前的專案時，改用清單上最近修改的另一個；一個都不剩時建立空白專案。
 * @returns 刪除之後目前的專案 id
 */
export async function deleteProject(db: string, id: string, active: string | null): Promise<string> {
  const blank = newProject()
  const fallbackId = newId()
  let nextActive = ''
  await kvUpdate<ProjectMeta[]>(
    db,
    'projects',
    (list = []) => {
      const rest = list.filter((p) => p.id !== id)
      if (active && active !== id && rest.some((p) => p.id === active)) {
        nextActive = active
        return rest
      }
      const next = [...rest].sort((a, b) => b.updated - a.updated)[0]
      nextActive = next?.id ?? fallbackId
      return next ? rest : [metaOf(fallbackId, blank, Date.now())]
    },
    () => (nextActive === fallbackId ? { [draftKey(fallbackId)]: blank, [builtKey(fallbackId)]: blank, active: fallbackId } : { active: nextActive }),
    [draftKey(id), builtKey(id)],
  )
  return nextActive
}
