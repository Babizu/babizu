/**
 * @file 展示版的 Excel（.xlsx）匯入：以 read-excel-file 讀出每個工作表，轉成與 CSV 相同的字串表格（見 tabular.ts）。
 *
 * - 套件約 3 MB，動態載入：只有使用者選了 .xlsx 才會下載。
 * - 儲存格統一成字串：數字照 Excel 顯示的值、日期是 yyyy-mm-dd、布林是 TRUE／FALSE；公式讀的是 Excel 上次存檔時算好的值。
 * - 舊版的 .xls（二進位格式）、其他格式讀不了時，丟出 TableError，說明怎麼辦。
 */

import { normalizeTable, TableError } from './tabular.ts'

/** 一個工作表 */
export interface Sheet {
  name: string
  /** 與 CSV 相同的表格（已去掉全空白的列；每格去掉前後空白、正規化成 NFC） */
  table: string[][]
}

/** .xlsx 是 zip（開頭 PK\x03\x04） */
export function isXlsx(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

/** 舊版 Excel（.xls）：OLE 複合文件的標頭 */
export function isLegacyXls(bytes: Uint8Array): boolean {
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return String(value)
}

/**
 * 讀活頁簿裡所有的工作表（依活頁簿中的順序）。
 * @throws TableError 不是 .xlsx（或檔案損壞）
 */
export async function readWorkbook(bytes: Uint8Array): Promise<Sheet[]> {
  if (isLegacyXls(bytes)) {
    throw new TableError('這是舊版的 Excel 檔（.xls）。請在 Excel 裡「另存新檔」成 .xlsx 或「CSV UTF-8（逗號分隔）」再匯入。')
  }
  if (!isXlsx(bytes)) throw new TableError('這不是 Excel（.xlsx）檔。')
  const { default: readXlsxFile } = await import('read-excel-file/browser')
  let sheets: Awaited<ReturnType<typeof readXlsxFile>>
  try {
    sheets = await readXlsxFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'InvalidSpreadsheetError' || name === 'InvalidInputError') {
      throw new TableError('這個檔案不是有效的 Excel（.xlsx）檔，可能已損壞，或是其他程式（例如 OpenDocument、Numbers）存的。請另存成「CSV UTF-8」再匯入。')
    }
    throw new TableError(`無法讀取這個 Excel 檔：${err instanceof Error ? err.message : String(err)}`)
  }
  return sheets.map(({ sheet, data }) => ({ name: sheet, table: normalizeTable(data.map((row) => row.map(cellText))) }))
}
