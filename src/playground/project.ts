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
import { msg, sourceText } from '../site/messages.ts'
import { localize, type Localized } from '../site/varieties.ts'

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
  /**
   * 詞根（這個詞衍生自哪個詞）。轉成記錄的 `morphology.derivedFrom`：查詞根會找到這個詞，詞條頁顯示「衍生自」。
   * 舊的專案檔沒有這一欄。
   */
  root?: string
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

/**
 * 一個問題：在哪裡、說什麼、嚴重程度。
 * - `path` 指向第一個出問題的位置（例如 `words[3].dialects`、`profile.rules[0].rules[2]`），工作台據此跳到那一列；
 * - `paths` 是同一個問題涉及的所有位置（例如用到同一個不存在的變體的每一列），工作台據此標紅；
 * - `level`：error 要修正才能建置；warning 只是提醒（例如完全重複的列）；
 * - `message` 是中文的訊息；`key`、`params` 是介面字串的鍵與參數（工作台以 t(key, params) 依語系顯示）。
 */
export interface ProjectIssue {
  path: string
  message: string
  level: 'error' | 'warning'
  key: string
  params?: Record<string, string | number>
  paths?: string[]
}

/** 有沒有擋住建置的問題 */
export function hasErrors(issues: ProjectIssue[]): boolean {
  return issues.some((i) => i.level === 'error')
}

/** 代入 {name} 參數 */
function fill(template: string, params: Record<string, string | number> = {}): string {
  return sourceText(template).replace(/\{(\w+)\}/gu, (all, name: string) => (name in params ? String(params[name]) : all))
}

/** 列出列號：太多時只列前幾個 */
function rowList(rows: number[], max = 8): string {
  const shown = rows.slice(0, max).map((k) => k + 1).join(', ')
  return rows.length > max ? `${shown}…` : shown
}

/** 列表上的一列怎麼稱呼：第 n 列（詞形） */
function rowName(k: number, text: string): string {
  return text ? `${k + 1}（${text.length > 24 ? `${text.slice(0, 24)}…` : text}）` : String(k + 1)
}

const isCost = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0
/** 變體代碼的格式（同站台設定） */
const VARIETY_CODE = /^[a-z][a-z0-9-]*$/

type AddIssue = (path: string, key: string, params?: Record<string, string | number>, level?: ProjectIssue['level'], paths?: string[]) => void

/** 詞表與例句的名稱 */
const LIST_NAMES = {
  words: { list: msg('詞表'), text: msg('詞形') },
  sentences: { list: msg('例句'), text: msg('句子') },
} as const

/**
 * 檢查專案，回傳問題清單（沒有 error 就可以建置）。
 *
 * 工作台編輯得到的部分（名稱、變體、方言規則、正規化、成本、構詞的平面清單、詞表）逐項檢查，
 * 訊息說「哪一個分頁、哪一列、怎麼改」；其餘交給語言設定檔的 validateProfile，
 * 最後實際建一次距離函式（只有建立時才會發現的問題）。
 */
export function validateProject(input: unknown): ProjectIssue[] {
  const issues: ProjectIssue[] = []
  const add: AddIssue = (path, key, params, level = 'error', paths) =>
    issues.push({ path, message: fill(key, params), level, key, ...(params ? { params } : {}), ...(paths && paths.length > 1 ? { paths } : {}) })
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    add('', msg('這不是專案（內容必須是一個 JSON 物件）'))
    return issues
  }
  const p = input as Partial<PlaygroundProject>
  if (p.format !== PROJECT_FORMAT) add('format', msg('這不是展示版的專案（format 必須是 "{format}"）'), { format: PROJECT_FORMAT })
  if (p.version !== PROJECT_VERSION) {
    if (typeof p.version === 'number' && p.version > PROJECT_VERSION) add('version', msg('專案檔的版本（{version}）比這個網站支援的（{supported}）新，請用新版的網站開啟'), { version: p.version, supported: PROJECT_VERSION })
    else add('version', msg('專案檔的版本必須是 {supported}'), { supported: PROJECT_VERSION })
  }
  if (!p.title || (typeof p.title === 'object' && !Object.values(p.title).some((t) => typeof t === 'string' && t.trim()))) add('title', msg('辭典需要名稱（「專案」分頁）'))

  // 語言變體
  const varieties = Array.isArray(p.varieties) ? p.varieties : []
  if (p.varieties !== undefined && !Array.isArray(p.varieties)) add('varieties', msg('語言變體必須是清單'))
  const codes = new Set<string>()
  varieties.forEach((v, k) => {
    const at = `varieties[${k}]`
    const code = typeof v?.code === 'string' ? v.code : ''
    if (!code) add(`${at}.code`, msg('語言變體第 {row} 列沒有代碼'), { row: k + 1 })
    else if (!VARIETY_CODE.test(code)) add(`${at}.code`, msg('語言變體第 {row} 列的代碼「{code}」只能用小寫英文字母、數字與連字號，而且要以英文字母開頭（例如 north、coast-2）'), { row: k + 1, code })
    else if (codes.has(code)) add(`${at}.code`, msg('語言變體的代碼「{code}」重複了（第 {first} 列與第 {row} 列）'), { code, first: varieties.findIndex((x) => x?.code === code) + 1, row: k + 1 })
    codes.add(code)
    const labels = typeof v?.label === 'string' ? [v.label] : Object.values(v?.label ?? {})
    if (code && !labels.some((l) => typeof l === 'string' && l.trim())) add(`${at}.label`, msg('語言變體「{code}」沒有名稱，網站上會直接顯示代碼'), { code }, 'warning')
    if (v?.hue !== undefined && !(typeof v.hue === 'number' && v.hue >= 0 && v.hue < 360)) add(`${at}.hue`, msg('語言變體「{code}」的色相必須是 0–359 的數字'), { code })
  })
  varieties.forEach((v, k) => {
    if (!v?.parent) return
    const at = `varieties[${k}].parent`
    if (v.parent === v.code) add(at, msg('語言變體「{code}」的上層不能是自己'), { code: v.code })
    else if (!codes.has(v.parent)) add(at, msg('語言變體「{code}」的上層「{parent}」不在變體清單中'), { code: v.code, parent: v.parent })
    else {
      // 上層形成循環（a 的上層是 b，b 的上層又是 a）
      const chain = [v.code]
      let cur: string | null | undefined = v.parent
      while (cur && !chain.includes(cur)) {
        chain.push(cur)
        cur = varieties.find((x) => x?.code === cur)?.parent
      }
      if (cur === v.code) add(at, msg('語言變體「{code}」的上層形成循環（{chain}）'), { code: v.code, chain: [...chain, v.code].join(' → ') })
    }
  })

  checkProfile(p.profile, add)

  // 詞表
  for (const list of ['words', 'sentences'] as const) {
    const names = LIST_NAMES[list]
    const rows = p[list]
    if (!Array.isArray(rows)) {
      add(list, msg('{list}必須是清單'), { list: sourceText(names.list) })
      continue
    }
    const ids = new Map<string, number>()
    const unknown = new Map<string, number[]>()
    const seen = new Map<string, number>()
    const duplicates: Array<[number, number]> = []
    const missing: number[] = []
    rows.forEach((row, k) => {
      const at = `${list}[${k}]`
      const text = typeof row?.text === 'string' ? row.text.trim() : ''
      if (typeof row?.id !== 'string' || !LOCAL_ID.test(row.id)) add(`${at}.id`, msg('{list}第 {row} 列的編號「{id}」只能有英數字、底線與連字號'), { list: sourceText(names.list), row: rowName(k, text), id: String(row?.id ?? '') })
      else if (ids.has(row.id)) add(`${at}.id`, msg('{list}第 {row} 列的編號「{id}」和第 {first} 列重複'), { list: sourceText(names.list), row: rowName(k, text), id: row.id, first: (ids.get(row.id) as number) + 1 })
      else ids.set(row.id, k)
      if (!text) missing.push(k)
      const root = (row as { root?: unknown } | undefined)?.root
      if (root !== undefined && typeof root !== 'string') add(`${at}.root`, msg('{list}第 {row} 列的詞根必須是文字'), { list: sourceText(names.list), row: rowName(k, text) })
      for (const d of Array.isArray(row?.dialects) ? row.dialects : []) {
        if (!codes.has(d)) unknown.set(d, [...(unknown.get(d) ?? []), k])
      }
      if (text) {
        const key = JSON.stringify([text, row.zh ?? '', row.en ?? '', [...(row.dialects ?? [])].sort(), (row as { root?: string }).root ?? ''])
        const first = seen.get(key)
        if (first === undefined) seen.set(key, k)
        else duplicates.push([first, k])
      }
    })
    const listName = sourceText(names.list)
    if (missing.length) {
      add(`${list}[${missing[0]}].text`, msg('{list}有 {count} 列沒有{text}（第 {rows} 列）。請填上，或刪掉這些列'), { list: listName, count: missing.length, text: sourceText(names.text), rows: rowList(missing) }, 'error', missing.map((k) => `${list}[${k}].text`))
    }
    for (const [code, ks] of unknown) {
      add(`${list}[${ks[0]}].dialects`, msg('{list}有 {count} 列用到不在清單中的語言變體「{code}」（第 {rows} 列）。請在「專案」分頁新增這個變體，或從這些列拿掉'), { list: listName, count: ks.length, code, rows: rowList(ks) }, 'error', ks.map((k) => `${list}[${k}].dialects`))
    }
    if (duplicates.length) {
      const later = duplicates.map(([, k]) => k)
      add(`${list}[${later[0]}].text`, msg('{list}有 {count} 列和前面的列完全相同（第 {rows} 列）。內容、中英文、方言都一樣，可能是重複匯入'), { list: listName, count: duplicates.length, rows: rowList(later) }, 'warning', later.map((k) => `${list}[${k}].text`))
    }
  }
  return issues
}

/** 構詞平面清單的名稱 */
const AFFIX_LISTS = { prefixes: msg('前綴'), suffixes: msg('後綴'), infixes: msg('中綴') } as const
const COST_NAMES = { substitute: msg('替換'), delete: msg('刪除'), insert: msg('插入') } as const

/**
 * 檢查語言設定檔。工作台表格編輯得到的部分逐列檢查（訊息指出規則組與列）；
 * 這些都沒有問題時才跑 validateProfile 與建立距離函式，它們的訊息是設定檔的欄位路徑，前面標明「語言設定檔」。
 */
function checkProfile(profile: unknown, add: AddIssue): void {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    add('profile', msg('語言設定檔必須是一個 JSON 物件（「進階」分頁）'))
    return
  }
  const pr = profile as Partial<LanguageProfile>
  let found = false
  const addHere: AddIssue = (...args) => {
    if ((args[3] ?? 'error') === 'error') found = true
    add(...args)
  }

  // 方言規則
  if (Array.isArray(pr.rules)) {
    pr.rules.forEach((group, g) => {
      if (!Array.isArray(group?.rules)) return
      const name = typeof group.category === 'string' && group.category.trim() ? group.category.trim() : String(g + 1)
      group.rules.forEach((row, r) => {
        const at = `profile.rules[${g}].rules[${r}]`
        const src = Array.isArray(row) ? row[0] : row?.source
        const dst = Array.isArray(row) ? row[1] : row?.target
        const weight = Array.isArray(row) ? row[2] : row?.weight
        if (!src && !dst) addHere(at, msg('方言規則「{group}」第 {row} 條的寫法 A、B 都是空的。寫上至少一邊（另一邊留空表示脫落），或刪掉這一條'), { group: name, row: r + 1 })
        else if (!isCost(weight)) addHere(at, msg('方言規則「{group}」第 {row} 條（{rule}）的權重要是 0 以上的數字（例如 0.1）'), { group: name, row: r + 1, rule: `${src || '∅'} ↔ ${dst || '∅'}` })
        else if (src === dst) addHere(at, msg('方言規則「{group}」第 {row} 條的寫法 A、B 相同（{form}），這條規則沒有作用'), { group: name, row: r + 1, form: String(src) }, 'warning')
      })
    })
  }

  // 正規化與成本
  const charMap = pr.normalizer?.charMap
  if (charMap && typeof charMap === 'object') {
    for (const [from, to] of Object.entries(charMap)) {
      if (typeof to !== 'string') addHere('profile.normalizer.charMap', msg('正規化的字元對照「{from}」的目標必須是文字'), { from })
    }
  }
  for (const key of ['substitute', 'delete', 'insert'] as const) {
    const v = pr.costs?.[key]
    if (v !== undefined && !isCost(v)) addHere(`profile.costs.${key}`, msg('基本成本「{name}」要是 0 以上的數字'), { name: sourceText(COST_NAMES[key]) })
  }

  // 構詞（平面清單；構詞文法交給 validateProfile）
  const m = pr.morphology as Record<string, unknown> | undefined
  if (m && typeof m === 'object' && !('morphemes' in m)) {
    for (const [key, label] of Object.entries(AFFIX_LISTS)) {
      const list = m[key]
      if (!Array.isArray(list)) continue
      const name = sourceText(label)
      const forms = new Map<string, number>()
      list.forEach((a: { form?: unknown; cost?: unknown }, i) => {
        const at = `profile.morphology.${key}[${i}]`
        const form = typeof a?.form === 'string' ? a.form : ''
        if (!form.trim()) addHere(at, msg('構詞：{kind}第 {row} 個沒有寫法。填上（例如 ma），或刪掉這一列'), { kind: name, row: i + 1 })
        else if (/\s/u.test(form)) addHere(at, msg('構詞：{kind}「{form}」不能有空白（詞綴不跨越詞的邊界）'), { kind: name, form })
        else if (/^[-<]|[->]$/u.test(form)) addHere(at, msg('構詞：{kind}「{form}」不用寫連字號或角括號，只寫字母（例如 {plain}）'), { kind: name, form, plain: form.replace(/^[-<]+|[->]+$/gu, '') })
        else if (forms.has(form)) addHere(at, msg('構詞：{kind}「{form}」重複了（第 {first} 個與第 {row} 個）'), { kind: name, form, first: (forms.get(form) as number) + 1, row: i + 1 }, 'warning')
        else forms.set(form, i)
        if (a?.cost !== undefined && !isCost(a.cost)) addHere(at, msg('構詞：{kind}「{form}」的成本要是 0 以上的數字'), { kind: name, form })
      })
    }
    const reduplication = m.reduplication
    if (Array.isArray(reduplication)) {
      const seen = new Map<string, number>()
      reduplication.forEach((r: { pattern?: unknown }, i) => {
        const pattern = typeof r?.pattern === 'string' ? r.pattern : ''
        if (!pattern) return
        if (seen.has(pattern)) addHere(`profile.morphology.reduplication[${i}]`, msg('構詞：重疊型式「{pattern}」重複了（第 {first} 個與第 {row} 個）'), { pattern, first: (seen.get(pattern) as number) + 1, row: i + 1 }, 'warning')
        else seen.set(pattern, i)
      })
    }
    const alternations = m.alternations
    if (Array.isArray(alternations)) {
      alternations.forEach((a: { underlying?: unknown; surface?: unknown }, i) => {
        if (!a?.underlying && !a?.surface) addHere(`profile.morphology.alternations[${i}]`, msg('構詞音變第 {row} 條的底層、表面都是空的。填上，或刪掉這一條'), { row: i + 1 })
      })
    }
  }
  if (found) return

  const errors = validateProfile(profile)
  for (const e of errors) {
    const field = /^(morphology|rules|normalizer|costs|boundaries)[\w.[\]]*/u.exec(e)?.[0]
    add(field ? `profile.${field}` : 'profile', msg('語言設定檔：{detail}'), { detail: e })
  }
  if (errors.length) return
  try {
    createTextTools(profile as LanguageProfile).createSearchMetric()
  } catch (err) {
    add('profile', msg('語言設定檔無法使用：{detail}'), { detail: err instanceof Error ? err.message : String(err) })
  }
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
        ...(w.root?.trim() ? { morphology: { formType: null, segmentation: null, gloss: null, derivedFrom: [{ relation: '<' as const, text: w.root.trim() }] } } : {}),
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
