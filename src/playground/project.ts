/**
 * @file 展示版的專案（docs/playground.md）：在瀏覽器裡編輯的詞表、例句、語言變體與語言設定檔。
 *
 * 一個專案就是一部小辭典的全部原料。展示版把它轉成標準資料集（一個來源、詞與例句兩個分片），
 * 再以與 `babizu build` 相同的程式建置（src/site/site-data.ts）。不碰檔案，瀏覽器與 Node 都能用。
 */

import { validateProfile, type LanguageProfile } from '#bcdp'
import { computeStats, type LoadedSource } from '../dataset-core.ts'
import { createCitation, createGroup, createRecord, createSense } from '../schema/records.ts'
import type { CorpusRecord, CorpusSource } from '../schema/types.ts'
import { createTextTools } from '../search/text.ts'
import { localize, resolveVarieties, type Localized } from '../site/varieties.ts'

export const PROJECT_FORMAT = 'babizu-playground-project'
export const PROJECT_VERSION = 1

/** 專案轉成的資料集只有這一個來源 */
export const PLAYGROUND_SOURCE = 'playground'

/** 一個語言變體（方言） */
export interface ProjectVariety {
  code: string
  label: Localized
  parent?: string | null
  hue?: number
}

/** 詞表的一列（空字串表示沒有） */
export interface ProjectWord {
  /** 記錄的本地編號（網址的一部分，專案內唯一） */
  id: string
  /** 詞形 */
  text: string
  zh: string
  en: string
  /** 語言變體的代碼 */
  dialects: string[]
  /** 詞類 */
  pos: string
  /** 其他寫法 */
  alt: string[]
  note: string
}

/** 例句的一列 */
export interface ProjectSentence {
  id: string
  text: string
  zh: string
  en: string
  dialects: string[]
  /** 備註（例如出處）；舊的專案檔沒有這一欄 */
  note?: string
}

export interface PlaygroundProject {
  format: typeof PROJECT_FORMAT
  version: typeof PROJECT_VERSION
  title: Localized
  description?: Localized
  varieties: ProjectVariety[]
  profile: LanguageProfile
  words: ProjectWord[]
  sentences: ProjectSentence[]
  /** 搜尋頁的範例查詢 */
  examples?: Array<{ q: string; note?: Localized }>
  /** 演算法實驗室的預設輸入 */
  lab?: { pairs?: Array<[string, string]>; words?: string; morph?: { examples?: Array<[string, string]> } }
}

/** 空白的專案 */
export function newProject(title: Localized = { 'zh-TW': '新的辭典', en: 'New dictionary' }): PlaygroundProject {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    title,
    varieties: [],
    profile: { format: 'babizu-language-profile', version: 1, rules: [] },
    words: [],
    sentences: [],
  }
}

/** 本地編號的格式（網址的一部分） */
const LOCAL_ID = /^[A-Za-z0-9_-]+$/

/** 下一個沒用過的編號（`w1`、`w2`…） */
export function nextId(prefix: string, used: Iterable<string>): () => string {
  const taken = new Set(used)
  let n = 1
  return () => {
    while (taken.has(`${prefix}${n}`)) n++
    const id = `${prefix}${n}`
    taken.add(id)
    return id
  }
}

/** 一個問題：在哪裡（例如 `words[3].dialects`）、說什麼 */
export interface ProjectIssue {
  path: string
  message: string
}

/**
 * 檢查專案，回傳問題清單（空陣列表示可以建置）。
 * 語言設定檔除了結構（validateProfile）之外，也實際建一次距離函式與構詞分析：
 * 規則的權重、兩邊都空白的規則等只有在建立時才會發現。
 */
export function validateProject(input: unknown): ProjectIssue[] {
  const issues: ProjectIssue[] = []
  const add = (path: string, message: string) => issues.push({ path, message })
  if (!input || typeof input !== 'object') return [{ path: '', message: '專案必須是物件' }]
  const p = input as Partial<PlaygroundProject>
  if (p.format !== PROJECT_FORMAT) add('format', `format 必須是 "${PROJECT_FORMAT}"`)
  if (p.version !== PROJECT_VERSION) add('version', `version 必須是 ${PROJECT_VERSION}`)
  if (!p.title || (typeof p.title === 'object' && !Object.values(p.title).some((t) => typeof t === 'string' && t.trim()))) add('title', '需要辭典的名稱')

  const varietyErrors: string[] = []
  resolveVarieties(Array.isArray(p.varieties) ? p.varieties : [], ['zh-TW'], 'zh-TW', varietyErrors)
  for (const e of varietyErrors) add('varieties', e)
  const codes = new Set((Array.isArray(p.varieties) ? p.varieties : []).map((v) => v.code))

  const profileErrors = validateProfile(p.profile)
  for (const e of profileErrors) add('profile', e)
  if (profileErrors.length === 0) {
    try {
      const text = createTextTools(p.profile as LanguageProfile)
      text.createSearchMetric()
    } catch (err) {
      add('profile', err instanceof Error ? err.message : String(err))
    }
  }

  for (const [list, prefix] of [
    ['words', '詞'],
    ['sentences', '例句'],
  ] as const) {
    const rows = p[list]
    if (!Array.isArray(rows)) {
      add(list, `${list} 必須是陣列`)
      continue
    }
    const ids = new Set<string>()
    rows.forEach((row, k) => {
      const at = `${list}[${k}]`
      if (typeof row?.id !== 'string' || !LOCAL_ID.test(row.id)) add(`${at}.id`, `${prefix}第 ${k + 1} 列的編號只能有英數、底線與連字號`)
      else if (ids.has(row.id)) add(`${at}.id`, `${prefix}第 ${k + 1} 列的編號「${row.id}」重複`)
      else ids.add(row.id)
      if (typeof row?.text !== 'string' || !row.text.trim()) add(`${at}.text`, `${prefix}第 ${k + 1} 列沒有${list === 'words' ? '詞形' : '句子'}`)
      for (const d of Array.isArray(row?.dialects) ? row.dialects : []) {
        if (!codes.has(d)) add(`${at}.dialects`, `${prefix}第 ${k + 1} 列的語言變體「${d}」不在變體清單中`)
      }
    })
  }
  return issues
}

/**
 * 專案 → 標準資料集（一個來源 playground；詞、例句兩個分片，各一個清單群組）。
 * 記錄由 createRecord 產生，格式一定正確。含空白的詞形是片語（phrase）。
 * @param locale 來源名稱用哪個語系的辭典名稱
 */
export function projectToDataset(project: PlaygroundProject, locale = 'zh-TW'): LoadedSource[] {
  const title = localize(project.title, [locale], locale)?.[locale] ?? PLAYGROUND_SOURCE
  const words = createGroup({ source: PLAYGROUND_SOURCE, localId: 'words', type: 'list', title: '詞' })
  const sentences = createGroup({ source: PLAYGROUND_SOURCE, localId: 'sentences', type: 'list', title: '例句' })
  const citation = (id: string) => createCitation(`${title} ${id}`, { code: id })
  const wordRecords: CorpusRecord[] = project.words.map((w, seq) =>
    createRecord(
      { source: PLAYGROUND_SOURCE, localId: w.id, unit: /\s/u.test(w.text.trim()) ? 'phrase' : 'word', text: w.text.trim(), citation: citation(w.id) },
      {
        senses: w.zh || w.en ? [createSense({ zh: w.zh, en: w.en })] : [],
        dialects: [...w.dialects],
        pos: w.pos.trim() || null,
        variants: w.alt.map((a) => a.trim()).filter(Boolean).map((text) => ({ relation: '~' as const, text })),
        notes: w.note.trim() ? [w.note.trim()] : [],
        group: { id: words.id, role: 'item', parent: null, seq },
      },
    ),
  )
  const sentenceRecords: CorpusRecord[] = project.sentences.map((s, seq) =>
    createRecord(
      { source: PLAYGROUND_SOURCE, localId: s.id, unit: 'sentence', text: s.text.trim(), citation: citation(s.id) },
      {
        senses: s.zh || s.en ? [createSense({ zh: s.zh, en: s.en })] : [],
        dialects: [...s.dialects],
        notes: s.note?.trim() ? [s.note.trim()] : [],
        group: { id: sentences.id, role: 'item', parent: null, seq },
      },
    ),
  )
  const shards = [
    { key: 'words', label: '詞', groups: [words], records: wordRecords },
    { key: 'sentences', label: '例句', groups: [sentences], records: sentenceRecords },
  ]
  const description = localize(project.description, [locale], locale)?.[locale] ?? null
  const source: CorpusSource = {
    id: PLAYGROUND_SOURCE,
    title,
    shortTitle: title,
    type: 'wordlist',
    description,
    authors: [],
    year: null,
    publisher: null,
    citation: null,
    url: null,
    license: null,
    defaultDialects: [],
    orthography: null,
    browse: { mode: 'list', shardLabel: '部分' },
    reviewTracked: false,
    notes: [],
    stats: computeStats(shards),
  }
  return [{ source, shards }]
}
