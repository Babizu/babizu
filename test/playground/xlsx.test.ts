/**
 * 展示版的 Excel（.xlsx）匯入（src/playground/xlsx.ts）：以 read-excel-file 讀出各個工作表，
 * 轉成與 CSV 相同的表格，之後的欄首對應、詞根欄、轉成專案的詞都和 CSV 一樣。
 *
 * 檔案由 fflate 照 Office Open XML 的規格組出（deflate 壓縮、共用字串、樣式與日期格式），
 * 涵蓋 Excel 實際會存出的各種儲存格。
 */

import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { guessRoles, parseTable, tableToWords } from '../../src/playground/tabular.ts'
import { isLegacyXls, isXlsx, readWorkbook } from '../../src/playground/xlsx.ts'
import { TableError } from '../../src/playground/tabular.ts'
import { workbook, type Cell } from './xlsx-fixture.ts'

/** 一個表格（字串）→ 只有一個工作表的 .xlsx */
const xlsxOf = (table: string[][], opts?: { compress?: boolean }) => workbook([{ name: 'Sheet1', rows: table }], opts)

// ───────────────────────── 測試 ─────────────────────────

describe('讀 .xlsx：儲存格轉成字串', () => {
  it('字串（共用與行內）、數字、布林、日期、公式的算好的值；空儲存格與空白列', async () => {
    const [sheet] = await readWorkbook(
      workbook([
        {
          name: '詞表',
          rows: [
            ['詞', '次數', '常用', '日期', '公式', '行內'],
            ['kita', 3, true, new Date(Date.UTC(2024, 4, 6)), { formula: 'B2*2', value: 6 }, { inline: ' 前後空白 ' }],
            [],
            ['batu', 1.5, false, null, { formula: 'A3&"!"', value: 'batu!' }, null],
            [null, null, null, null, null, null],
            ['終', -7, null, null, null, 'x'],
          ],
        },
      ]),
    )
    expect(sheet.name).toBe('詞表')
    expect(sheet.table).toEqual([
      ['詞', '次數', '常用', '日期', '公式', '行內'],
      ['kita', '3', 'TRUE', '2024-05-06', '6', '前後空白'],
      ['batu', '1.5', 'FALSE', '', 'batu!', ''],
      ['終', '-7', '', '', '', 'x'],
    ])
  })

  it('跳過的欄：中間的空儲存格補成空字串，欄位不位移', async () => {
    const rows: Cell[][] = [['a', null, null, 'd']]
    const [sheet] = await readWorkbook(workbook([{ name: 'S', rows }]))
    expect(sheet.table).toEqual([['a', '', '', 'd']])
  })

  it('壓縮與不壓縮的 zip 都讀得到（Excel 存的是 deflate）', async () => {
    const table = [['詞', '中文'], ['kita', '看']]
    expect((await readWorkbook(xlsxOf(table, { compress: true })))[0].table).toEqual(table)
    expect((await readWorkbook(xlsxOf(table, { compress: false })))[0].table).toEqual(table)
  })

  it('每格去掉前後空白、組合用字元統一成 NFC', async () => {
    const [sheet] = await readWorkbook(xlsxOf([['  é  ', 'x́']]))
    expect(sheet.table).toEqual([['é', 'x́'.normalize('NFC')]])
  })

  it('格子裡的換行、逗號、引號原樣保留', async () => {
    const cell = 'a, "b"\nc'
    const [sheet] = await readWorkbook(xlsxOf([['詞'], [cell]]))
    expect(sheet.table[1][0]).toBe(cell)
  })

  it('特殊字元（& < >）與 CJK 擴充字、emoji', async () => {
    const [sheet] = await readWorkbook(xlsxOf([['a&b<c>', '𠀀 𪚥', '🙂']]))
    expect(sheet.table).toEqual([['a&b<c>', '𠀀 𪚥', '🙂']])
  })
})

describe('讀 .xlsx：多個工作表', () => {
  const wb = workbook([
    { name: '詞', rows: [['詞', '詞根'], ['mubaket', 'baket']] },
    { name: '空的', rows: [] },
    { name: '例句', rows: [['句'], ['ma-baket ki aba']] },
    { name: '隱藏', rows: [['x']], hidden: true },
  ])

  it('依活頁簿中的順序列出所有工作表，名稱照原樣；空的工作表是空表格', async () => {
    const sheets = await readWorkbook(wb)
    expect(sheets.map((s) => [s.name, s.table.length])).toEqual([
      ['詞', 2],
      ['空的', 0],
      ['例句', 2],
      ['隱藏', 1],
    ])
    expect(sheets[2].table).toEqual([['句'], ['ma-baket ki aba']])
  })
})

describe('讀不了的檔：說明怎麼辦', () => {
  it('辨認格式：xlsx 是 zip，舊版 xls 是 OLE', () => {
    expect(isXlsx(xlsxOf([['a']]))).toBe(true)
    expect(isXlsx(new TextEncoder().encode('a,b'))).toBe(false)
    expect(isLegacyXls(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]))).toBe(true)
  })

  it('舊版 .xls：請另存成 .xlsx 或 CSV', async () => {
    await expect(readWorkbook(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).rejects.toThrow(/舊版.*\.xls.*另存/u)
  })

  it('不是 zip：這不是 Excel 檔', async () => {
    await expect(readWorkbook(new TextEncoder().encode('詞,中文\n'))).rejects.toThrow(TableError)
  })

  it('是 zip 但不是活頁簿（例如 docx 或 ods 的結構）：說明請另存 CSV', async () => {
    const other = zipSync({ 'content.xml': strToU8('<office/>'), mimetype: strToU8('application/vnd.oasis.opendocument.spreadsheet') })
    await expect(readWorkbook(other)).rejects.toThrow(TableError)
  })

  it('壞掉的 zip：不會當機，丟出說明', async () => {
    const good = xlsxOf([['a', 'b']])
    const broken = good.slice(0, Math.floor(good.length / 2))
    await expect(readWorkbook(broken)).rejects.toBeInstanceOf(TableError)
    await expect(readWorkbook(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]))).rejects.toBeInstanceOf(TableError)
  })
})

describe('Excel 與 CSV 讀成同一份資料', () => {
  /** 有陷阱的內容（同 csv.test.ts） */
  const TRICKY = [
    ['詞', '詞根', '中文', 'English', '方言', '備註'],
    ['kita, ita', 'kita', '看，見', 'see, look', 'pazeh', '逗號在格子裡'],
    ['ra"lan', '', '路', 'road', 'kaxabu', '引號在格子中間'],
    ['"quoted"', 'quote', '"引號"整個包住', 'say "hi"', 'pazeh、kaxabu', '兩個方言'],
    ['two\nlines', '', '第一行\n第二行', 'a\nb', '', '格子裡的換行'],
    ['空欄', '', '', '', '', ''],
    ['tutu', 'tu', '石頭', 'stone', 'pazeh', '最後一列'],
  ]
  const VARIETIES = [
    { code: 'pazeh', label: { 'zh-TW': '巴宰' } },
    { code: 'kaxabu', label: { 'zh-TW': '噶哈巫' } },
  ]

  it('同一份表格存成 CSV 與 xlsx，轉成的詞（含詞根）逐項相同', async () => {
    const csv = parseTable(TRICKY.map((r) => r.map((c) => `"${c.replace(/"/gu, '""')}"`).join(',')).join('\r\n'))
    const [sheet] = await readWorkbook(xlsxOf(TRICKY))
    expect(sheet.table).toEqual(csv)
    const convert = (t: string[][]) => tableToWords(t, guessRoles(t[0], t.slice(1)), { hasHeader: true, varieties: VARIETIES })
    expect(convert(sheet.table)).toEqual(convert(csv))
    expect(convert(sheet.table).rows[0]).toMatchObject({ text: 'kita, ita', root: 'kita', zh: '看，見', dialects: ['pazeh'] })
  })

  it('兩萬列的活頁簿：讀得完，內容與列數正確', async () => {
    const rows: Cell[][] = [['詞', '詞根', '數量']]
    for (let k = 0; k < 20000; k++) rows.push([`word${k}`, k % 2 ? `root${k}` : null, k])
    const started = Date.now()
    const [sheet] = await readWorkbook(workbook([{ name: 'big', rows }]))
    expect(sheet.table).toHaveLength(20001)
    expect(sheet.table[20000]).toEqual(['word19999', 'root19999', '19999'])
    expect(sheet.table[1]).toEqual(['word0', '', '0'])
    expect(Date.now() - started).toBeLessThan(10000)
  })
})
