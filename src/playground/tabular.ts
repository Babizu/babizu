/**
 * @file 展示版的詞表匯入：剖析 CSV、TSV（或從試算表貼上的文字），對應欄位，轉成專案的詞或例句。
 *
 * 不加套件：CSV 依 RFC 4180（雙引號包住的欄位可以有逗號、換行，"" 是一個引號）。
 * 分隔符號自動判斷：第一列有 tab 就是 TSV（試算表複製貼上也是 tab），否則逗號或分號（較多的那個）。
 */

import type { ProjectSentence, ProjectVariety, ProjectWord } from './project.ts'
import { nextId } from './project.ts'

/** 判斷分隔符號 */
export function detectDelimiter(text: string): '\t' | ',' | ';' {
  const first = text.replace(/^﻿/u, '').split(/\r?\n/u, 1)[0] ?? ''
  if (first.includes('\t')) return '\t'
  const count = (c: string) => first.split(c).length - 1
  return count(';') > count(',') ? ';' : ','
}

/**
 * 剖析分隔文字成表格。去掉 BOM、整列空白的列；每格去掉前後空白並正規化成 NFC。
 * @param delimiter 省略時自動判斷
 */
export function parseTable(text: string, delimiter: string = detectDelimiter(text)): string[][] {
  const src = text.replace(/^﻿/u, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  const endCell = () => {
    row.push(cell.normalize('NFC').trim())
    cell = ''
  }
  const endRow = () => {
    endCell()
    if (row.some((c) => c !== '')) rows.push(row)
    row = []
  }
  while (i < src.length) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      cell += c
      i++
      continue
    }
    if (c === '"' && cell.trim() === '') {
      quoted = true
      cell = ''
      i++
    } else if (c === delimiter) {
      endCell()
      i++
    } else if (c === '\r' || c === '\n') {
      endRow()
      i += c === '\r' && src[i + 1] === '\n' ? 2 : 1
    } else {
      cell += c
      i++
    }
  }
  if (cell !== '' || row.length > 0) endRow()
  return rows
}

/** 一欄要對到什麼 */
export type ColumnRole = 'text' | 'zh' | 'en' | 'dialect' | 'pos' | 'alt' | 'note' | 'ignore'

export const COLUMN_ROLES: ColumnRole[] = ['text', 'zh', 'en', 'dialect', 'pos', 'alt', 'note', 'ignore']

/** 依表頭猜每一欄的用途（猜不到的不用；同一種用途只給第一個符合的欄） */
export function guessRoles(header: string[]): ColumnRole[] {
  const patterns: Array<[Exclude<ColumnRole, 'ignore'>, RegExp]> = [
    ['text', /^(詞形?|詞彙|族語|語詞|拼寫|word|form|lexeme|headword|text|entry)$/iu],
    ['zh', /^(中文|華語|國語|釋義|意思|中文釋義|zh|chinese|mandarin|gloss)$/iu],
    ['en', /^(英文|英語|en|english|english gloss)$/iu],
    ['dialect', /^(方言|語言變體|變體|語別|dialect|variety|doculect|language)$/iu],
    ['pos', /^(詞類|詞性|pos|part of speech)$/iu],
    ['alt', /^(其他寫法|異體|變體寫法|alt|alternative|variant|variants)$/iu],
    ['note', /^(備註|附註|說明|note|notes|comment)$/iu],
  ]
  const used = new Set<ColumnRole>()
  return header.map((h) => {
    const hit = patterns.find(([role, re]) => !used.has(role) && re.test(h.trim()))
    if (!hit) return 'ignore'
    used.add(hit[0])
    return hit[0]
  })
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
  /** 沒有詞形（或句子）而略過的列數 */
  skipped: number
}

/**
 * 表格 → 專案的詞。
 * @param usedIds 已經用掉的編號（附加到既有的詞表時）
 */
export function tableToWords(table: string[][], roles: ColumnRole[], { hasHeader, varieties, usedIds = [] }: { hasHeader: boolean; varieties: ProjectVariety[]; usedIds?: Iterable<string> }): ImportResult<ProjectWord> {
  const next = nextId('w', usedIds)
  const unknown = new Set<string>()
  let skipped = 0
  const rows: ProjectWord[] = []
  for (const cells of hasHeader ? table.slice(1) : table) {
    const get = (role: ColumnRole) => roles.flatMap((r, k) => (r === role && cells[k] ? [cells[k]] : []))
    const text = get('text')[0] ?? ''
    if (!text) {
      skipped++
      continue
    }
    const dialects = matchDialects(get('dialect').join(','), varieties)
    for (const u of dialects.unknown) unknown.add(u)
    rows.push({
      id: next(),
      text,
      zh: get('zh').join('；'),
      en: get('en').join('; '),
      dialects: dialects.codes,
      pos: get('pos')[0] ?? '',
      alt: get('alt').flatMap((a) => a.split(LIST_SPLIT)).map((a) => a.trim()).filter(Boolean),
      note: get('note').join('；'),
    })
  }
  return { rows, unknownDialects: [...unknown], skipped }
}

/** 表格 → 專案的例句（用到的欄：text、zh、en、dialect） */
export function tableToSentences(table: string[][], roles: ColumnRole[], { hasHeader, varieties, usedIds = [] }: { hasHeader: boolean; varieties: ProjectVariety[]; usedIds?: Iterable<string> }): ImportResult<ProjectSentence> {
  const words = tableToWords(table, roles, { hasHeader, varieties })
  const next = nextId('s', usedIds)
  return { ...words, rows: words.rows.map(({ text, zh, en, dialects }) => ({ id: next(), text, zh, en, dialects })) }
}
