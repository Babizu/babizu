/**
 * @file 展示版的詞表匯入：讀 CSV 檔（或從試算表貼上的文字），對應欄首，轉成專案的詞或例句。
 *
 * - 剖析交給 csv-parse（RFC 4180：雙引號包住的欄位可以有分隔符號、換行，"" 是一個引號）。
 * - 換行：Windows（CRLF）、舊 Mac（CR）、Unix（LF）混在同一個檔也可以，先統一成 LF 再剖析。
 * - 編碼：UTF-8（有沒有 BOM 都可以）、UTF-16（Excel 的「Unicode 文字」）；不是合法的 UTF-8 時當成 Big5
 *   （中文版 Excel「另存成 CSV」的預設編碼）。
 * - 分隔符號自動判斷：逗號、分號（部分歐洲語系的 Excel）、tab（從試算表複製貼上）。
 * - 欄首對應：依欄首的名稱（中英文的常見寫法，大小寫、空白、底線不計）猜用途；「gloss」「釋義」這類
 *   不分語言的欄首，看內容是中文還是拉丁字母決定對到中文或英文。使用者改過的對應可以記下來（rememberRoles）。
 */

import { parse, CsvError } from 'csv-parse/browser/esm/sync'
import type { ProjectSentence, ProjectVariety, ProjectWord } from './project.ts'
import { nextId } from './project.ts'

/** 讀表格時的問題（訊息給使用者看） */
export class TableError extends Error {
  /** 出問題的行號（從 1 起算，換行統一之後的行） */
  readonly line: number | undefined

  constructor(message: string, line?: number) {
    super(message)
    this.name = 'TableError'
    this.line = line
  }
}

/** 解碼檔案的內容；回傳文字與用了哪種編碼 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'big5' } {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    throw new TableError('這是 Excel 或其他壓縮格式的檔案，不是 CSV。請在試算表軟體裡「另存新檔」，格式選「CSV UTF-8（逗號分隔）」再匯入。')
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes), encoding: 'utf-8' }
  } catch {
    // 不是合法的 UTF-8：中文版 Excel 預設存成 Big5
  }
  try {
    return { text: new TextDecoder('big5', { fatal: true }).decode(bytes), encoding: 'big5' }
  } catch {
    throw new TableError('無法判斷這個檔案的文字編碼（不是 UTF-8，也不是 Big5）。請在試算表軟體裡另存成「CSV UTF-8」再匯入。')
  }
}

/** 換行統一成 LF、去掉 BOM */
function normalizeNewlines(text: string): string {
  return text.replace(/^﻿/u, '').replace(/\r\n?/gu, '\n')
}

/** 數第一筆記錄（引號外）裡各種分隔符號的個數 */
function countOutsideQuotes(text: string): Record<'\t' | ',' | ';', number> {
  const count = { '\t': 0, ',': 0, ';': 0 }
  let quoted = false
  for (const c of text) {
    if (c === '"') quoted = !quoted
    else if (!quoted && c === '\n') break
    else if (!quoted && (c === '\t' || c === ',' || c === ';')) count[c]++
  }
  return count
}

/** 判斷分隔符號：第一筆記錄（引號外）有 tab 就是 tab，否則逗號或分號（較多的那個） */
export function detectDelimiter(text: string): '\t' | ',' | ';' {
  const count = countOutsideQuotes(normalizeNewlines(text))
  if (count['\t'] > 0) return '\t'
  return count[';'] > count[','] ? ';' : ','
}

/** 沒有關上的引號從第幾行開始（從 1 起算） */
function unclosedQuoteLine(src: string): number | undefined {
  let line = 1
  let openedAt: number | undefined
  for (const c of src) {
    if (c === '"') openedAt = openedAt === undefined ? line : undefined
    else if (c === '\n') line++
  }
  return openedAt
}

/** csv-parse 的錯誤 → 給使用者看的說明 */
function explainCsvError(err: CsvError, src: string): TableError {
  let line = (err as CsvError & { lines?: number }).lines
  if (err.code === 'CSV_QUOTE_NOT_CLOSED') line = unclosedQuoteLine(src) ?? line
  const at = line ? `第 ${line} 行：` : ''
  switch (err.code) {
    case 'CSV_QUOTE_NOT_CLOSED':
      return new TableError(`${at}有一格以雙引號 " 開頭，但到檔案結尾都沒有對應的結束引號。請檢查那一格，或把格子裡的 " 寫成 ""。`, line)
    case 'CSV_INVALID_CLOSING_QUOTE':
    case 'CSV_NON_TRIMABLE_CHAR_AFTER_CLOSING_QUOTE':
      return new TableError(`${at}引號的位置不對：一格的結束引號 " 後面還有其他文字。格子裡要放引號時寫成 ""，整格再用 " 包起來。`, line)
    case 'CSV_MAX_RECORD_SIZE':
      return new TableError(`${at}有一筆資料太長，可能是引號沒有關上。`, line)
    default:
      return new TableError(`${at}${err.message}`, line)
  }
}

/**
 * 剖析 CSV（或 TSV、分號分隔）文字成表格。去掉 BOM、整列空白的列；每格去掉前後空白並正規化成 NFC。
 * 各列的欄數可以不同（試算表常有尾端的空欄）。剖析失敗時丟出 TableError。
 * @param delimiter 省略時自動判斷
 */
export function parseTable(text: string, delimiter: string = detectDelimiter(text)): string[][] {
  const src = normalizeNewlines(text)
  let rows: string[][]
  try {
    rows = parse(src, { delimiter, record_delimiter: '\n', relax_column_count: true, relax_quotes: true, skip_empty_lines: true, quote: '"', escape: '"' })
  } catch (err) {
    if (err instanceof CsvError) throw explainCsvError(err, src)
    throw err
  }
  return rows.map((row) => row.map((cell) => cell.normalize('NFC').trim())).filter((row) => row.some((cell) => cell !== ''))
}

/** 一欄要對到什麼 */
export type ColumnRole = 'text' | 'root' | 'zh' | 'en' | 'dialect' | 'pos' | 'alt' | 'note' | 'ignore'

export const COLUMN_ROLES: ColumnRole[] = ['text', 'root', 'zh', 'en', 'dialect', 'pos', 'alt', 'note', 'ignore']

/** 欄首的比對鍵：小寫、去掉空白、底線、連字號、括號與常見標點 */
export function headerKey(header: string): string {
  return header
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_\-.:：()（）[\]【】]+/gu, '')
}

/** 欄首的常見寫法（比對鍵）。gloss 這類不分語言的放在 GLOSS，依內容決定 */
const HEADER_NAMES: Array<[Exclude<ColumnRole, 'ignore'>, string[]]> = [
  ['text', ['詞', '詞形', '詞彙', '族語', '族語詞', '族語詞彙', '語詞', '拼寫', '原文', '句子', '族語句子', '例句', 'word', 'words', 'form', 'wordform', 'lexeme', 'headword', 'lemma', 'text', 'entry', 'sentence', 'vernacular', 'native', 'orthography', 'tokens']],
  ['root', ['詞根', '字根', '語根', '詞幹', '根詞', '衍生自', '來源詞', '原詞', 'root', 'roots', 'rootword', 'stem', 'base', 'baseform', 'derivedfrom', 'etymon']],
  ['zh', ['中文', '華語', '國語', '漢語', '中文釋義', '中文意思', '中文翻譯', '華語釋義', '華語翻譯', 'zh', 'zhtw', 'chinese', 'mandarin', 'chinesegloss', 'mandaringloss', 'glosszh']],
  ['en', ['英文', '英語', '英文釋義', '英文意思', '英文翻譯', 'en', 'eng', 'english', 'englishgloss', 'englishtranslation', 'glossen', 'glosseng']],
  ['dialect', ['方言', '方言別', '方言點', '語言變體', '變體', '語別', '地區', '地點', '部落', '社', 'dialect', 'dialects', 'variety', 'varieties', 'dialectname', 'dialectcode', 'varietyname', 'doculect', 'language', 'lect', 'locality', 'place', 'region']],
  ['pos', ['詞類', '詞性', 'pos', 'partofspeech', 'wordclass', 'category', 'ps']],
  ['alt', ['其他寫法', '異體', '異寫', '變體寫法', '其他拼寫', 'alt', 'alternative', 'alternatives', 'variant', 'variants', 'spellingvariants', 'altform', 'altforms']],
  ['note', ['備註', '附註', '說明', '註', '註解', '出處', '來源', 'note', 'notes', 'comment', 'comments', 'remark', 'remarks', 'source']],
]
/** 不分語言的「意思」欄：依內容是中文還是拉丁字母決定 */
const GLOSS_NAMES = new Set(['gloss', 'glosses', 'meaning', 'meanings', 'definition', 'definitions', 'translation', 'translations', 'sense', '釋義', '意思', '意義', '翻譯', '解釋', '詞義'])

/** 一欄的內容主要是中文（漢字較多）還是拉丁字母 */
function scriptOf(values: string[]): 'han' | 'latin' | null {
  let han = 0
  let latin = 0
  for (const v of values) {
    han += (v.match(/\p{Script=Han}/gu) ?? []).length
    latin += (v.match(/\p{Script=Latin}/gu) ?? []).length
  }
  if (!han && !latin) return null
  return han >= latin ? 'han' : 'latin'
}

/**
 * 依欄首（與內容）猜每一欄的用途。猜不到的不用；同一種用途只給第一個符合的欄。
 * @param body 欄首以下的幾列（判斷 gloss 這類欄首是中文還是英文）；省略時 gloss 當中文
 * @param remembered 使用者以前選過的對應（比對鍵 → 用途），優先採用
 */
export function guessRoles(header: string[], body: string[][] = [], remembered: Record<string, ColumnRole> = {}): ColumnRole[] {
  const used = new Set<ColumnRole>()
  const roles: ColumnRole[] = header.map(() => 'ignore')
  /** 已經決定的欄（記住的「不用」也算決定了） */
  const decided = new Set<number>()
  const take = (k: number, role: ColumnRole) => {
    if (role === 'ignore' || used.has(role)) return false
    roles[k] = role
    used.add(role)
    decided.add(k)
    return true
  }
  // 依序：記住的對應、名稱完全符合、不分語言的意思欄
  header.forEach((h, k) => {
    const r = remembered[headerKey(h)]
    if (r === 'ignore') decided.add(k)
    else if (r) take(k, r)
  })
  header.forEach((h, k) => {
    if (decided.has(k)) return
    const key = headerKey(h)
    const hit = HEADER_NAMES.find(([role, names]) => !used.has(role) && names.includes(key))
    if (hit) take(k, hit[0])
  })
  header.forEach((h, k) => {
    if (decided.has(k) || !GLOSS_NAMES.has(headerKey(h))) return
    const script = scriptOf(body.map((row) => row[k] ?? ''))
    const preferred: ColumnRole = script === 'latin' ? 'en' : 'zh'
    if (!take(k, preferred)) take(k, preferred === 'zh' ? 'en' : 'zh')
  })
  return roles
}

/**
 * 使用者選定的對應裡，哪些值得記住：與自動猜的結果不同的欄（含改成「不用」的）。
 * @returns 比對鍵 → 用途（併進原本記住的對應）
 */
export function rolesToRemember(header: string[], chosen: ColumnRole[], guessed: ColumnRole[], remembered: Record<string, ColumnRole> = {}): Record<string, ColumnRole> {
  const next = { ...remembered }
  header.forEach((h, k) => {
    const key = headerKey(h)
    if (!key) return
    if (chosen[k] !== guessed[k] || key in next) next[key] = chosen[k] ?? 'ignore'
  })
  return next
}

/** 方言欄可以有幾個值，以這些符號分開 */
const LIST_SPLIT = /[,，;；/、|]+/u

/**
 * 方言欄的值 → 變體代碼：可以寫代碼或任何一個語系的名稱（不分大小寫）。
 * @returns 對不到的值放在 unknown
 */
export function matchDialects(cell: string, varieties: ProjectVariety[]): { codes: string[]; unknown: string[] } {
  const codes: string[] = []
  const unknown: string[] = []
  for (const raw of cell.split(LIST_SPLIT).map((s) => s.trim()).filter(Boolean)) {
    const key = raw.toLowerCase()
    const v = varieties.find((x) => x.code === key || (typeof x.label === 'string' ? [x.label] : Object.values(x.label)).some((l) => l.trim().toLowerCase() === key))
    if (v) {
      if (!codes.includes(v.code)) codes.push(v.code)
    } else if (!unknown.includes(raw)) unknown.push(raw)
  }
  return { codes, unknown }
}

/**
 * 由名稱產生變體代碼：本身是合格的代碼（小寫英數與連字號）就用它，否則 v1、v2…
 */
export function suggestVarietyCode(label: string, used: Iterable<string>): string {
  const key = label.trim().toLowerCase().replace(/\s+/gu, '-')
  const taken = new Set(used)
  if (/^[a-z][a-z0-9-]*$/u.test(key) && !taken.has(key)) return key
  return nextId('v', taken)()
}

export interface ImportResult<T> {
  rows: T[]
  /** 方言欄中對不到變體的值 */
  unknownDialects: string[]
  /** 沒有詞形（或句子）而略過的列號（表格中的列，從 1 起算，含表頭） */
  skippedRows: number[]
  /** 與既有資料（或同一個檔裡前面的列）完全相同而略過的列號 */
  duplicateRows: number[]
}

export interface ImportOptions {
  hasHeader: boolean
  varieties: ProjectVariety[]
  /** 已經用掉的編號（附加到既有的詞表時） */
  usedIds?: Iterable<string>
  /** 既有的列：完全相同的列略過（附加時傳入；取代時不傳） */
  existing?: Array<ProjectWord | ProjectSentence>
  /** 同一個檔裡重複的列也略過 */
  skipDuplicates?: boolean
}

/** 判斷重複用的鍵：詞形、中英文、方言（排序後）都相同 */
const rowKey = (r: { text: string; zh: string; en: string; dialects: string[]; root?: string }) => JSON.stringify([r.text, r.zh, r.en, [...r.dialects].sort(), r.root ?? ''])

/** 表格 → 專案的詞 */
export function tableToWords(table: string[][], roles: ColumnRole[], { hasHeader, varieties, usedIds = [], existing = [], skipDuplicates = false }: ImportOptions): ImportResult<ProjectWord> {
  const next = nextId('w', usedIds)
  const unknown = new Set<string>()
  const skippedRows: number[] = []
  const duplicateRows: number[] = []
  const seen = new Set(skipDuplicates ? existing.map(rowKey) : [])
  const rows: ProjectWord[] = []
  const start = hasHeader ? 1 : 0
  for (let r = start; r < table.length; r++) {
    const cells = table[r]
    const get = (role: ColumnRole) => roles.flatMap((x, k) => (x === role && cells[k] ? [cells[k]] : []))
    const text = get('text')[0] ?? ''
    if (!text) {
      skippedRows.push(r + 1)
      continue
    }
    const dialects = matchDialects(get('dialect').join(','), varieties)
    for (const u of dialects.unknown) unknown.add(u)
    const row = {
      text,
      zh: get('zh').join('；'),
      en: get('en').join('; '),
      dialects: dialects.codes,
      pos: get('pos')[0] ?? '',
      alt: get('alt').flatMap((a) => a.split(LIST_SPLIT)).map((a) => a.trim()).filter(Boolean),
      note: get('note').join('；'),
      root: get('root')[0] ?? '',
    }
    if (skipDuplicates) {
      // 方言對不到的值也算進鍵：自動新增變體之後才不會把不同方言的列當成重複
      const key = rowKey({ ...row, dialects: [...row.dialects, ...dialects.unknown] })
      if (seen.has(key)) {
        duplicateRows.push(r + 1)
        continue
      }
      seen.add(key)
    }
    rows.push({ id: next(), ...row })
  }
  return { rows, unknownDialects: [...unknown], skippedRows, duplicateRows }
}

/** 表格 → 專案的例句（用到的欄：text、zh、en、dialect、note） */
export function tableToSentences(table: string[][], roles: ColumnRole[], { usedIds = [], ...opts }: ImportOptions): ImportResult<ProjectSentence> {
  const words = tableToWords(table, roles.map((r) => (r === 'root' ? 'ignore' : r)), opts)
  const next = nextId('s', usedIds)
  return { ...words, rows: words.rows.map(({ text, zh, en, dialects, note }) => ({ id: next(), text, zh, en, dialects, note })) }
}
