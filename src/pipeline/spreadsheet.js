/**
 * @file 試算表讀取：.xlsx 與 .csv 都轉成「列陣列」，並把儲存格統一成字串。
 */

import { readFile } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'
import { readSheet } from 'read-excel-file/node'

/**
 * @typedef {object} SheetRow
 * @property {number} row 原檔中的列號（從 1 起算，含表頭列）
 * @property {string[]} cells 儲存格文字（已 trim；空儲存格為空字串）
 */

/**
 * 讀取 .xlsx 的第一個工作表。
 * @param {string} path
 * @returns {Promise<SheetRow[]>}
 */
export async function readXlsxRows(path) {
  const rows = await readSheet(path)
  return rows.map((cells, k) => ({ row: k + 1, cells: cells.map(cellText) }))
}

/**
 * 讀取 .csv（UTF-8，可含 BOM）。
 * @param {string} path
 * @returns {Promise<SheetRow[]>}
 */
export async function readCsvRows(path) {
  const content = await readFile(path, 'utf8')
  /** @type {string[][]} */
  const rows = parse(content, { bom: true, relax_column_count: true, skip_empty_lines: false })
  return rows.map((cells, k) => ({ row: k + 1, cells: cells.map(cellText) }))
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cellText(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).normalize('NFC').trim()
}

/**
 * 「空值」判定：空字串或常見的佔位符號（---、—、-）。
 * @param {string} value
 */
export function isBlank(value) {
  return value === '' || /^[-—–]+$/u.test(value)
}

/**
 * 取非空值，否則 null。
 * @param {string | undefined} value
 */
export function orNull(value) {
  return value === undefined || isBlank(value) ? null : value
}
