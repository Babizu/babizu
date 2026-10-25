/**
 * 測試用的 .xlsx 產生器：照 Office Open XML 的規格組出活頁簿（deflate 壓縮、共用字串、樣式與日期格式），
 * 沒有 Excel 也能產生 Excel 實際會存出的各種儲存格。單元測試與端對端測試共用。
 */

import { zipSync, strToU8 } from 'fflate'

export type Cell = string | number | boolean | Date | null | { formula: string; value: string | number } | { inline: string }
export interface SheetSpec {
  name: string
  rows: Cell[][]
  hidden?: boolean
}

const esc = (s: string) => s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')
const colName = (k: number) => {
  let n = k + 1
  let out = ''
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}
/** Excel 的日期序號（1900 日期系統） */
const serial = (d: Date) => d.getTime() / 86400000 + 25569

export function workbook(sheets: SheetSpec[], { compress = true }: { compress?: boolean } = {}): Uint8Array {
  const shared: string[] = []
  const sharedIndex = (s: string) => {
    let k = shared.indexOf(s)
    if (k < 0) k = shared.push(s) - 1
    return k
  }
  const sheetXml = sheets.map(({ rows }) => {
    const body = rows
      .map((row, r) => {
        const cells = row
          .map((cell, c) => {
            const ref = `${colName(c)}${r + 1}`
            if (cell === null) return ''
            if (typeof cell === 'string') return `<c r="${ref}" t="s"><v>${sharedIndex(cell)}</v></c>`
            if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`
            if (typeof cell === 'boolean') return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`
            if (cell instanceof Date) return `<c r="${ref}" s="1"><v>${serial(cell)}</v></c>`
            if ('inline' in cell) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(cell.inline)}</t></is></c>`
            // 公式：Excel 把上次算好的值存在 <v>
            return typeof cell.value === 'number'
              ? `<c r="${ref}"><f>${esc(cell.formula)}</f><v>${cell.value}</v></c>`
              : `<c r="${ref}" t="str"><f>${esc(cell.formula)}</f><v>${esc(cell.value)}</v></c>`
          })
          .join('')
        return row.length ? `<row r="${r + 1}">${cells}</row>` : `<row r="${r + 1}"/>`
      })
      .join('')
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
  })
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, k) => `<Override PartName="/xl/worksheets/sheet${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, k) => `<sheet name="${esc(s.name)}" sheetId="${k + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${k + 1}"/>`).join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, k) => `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${k + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    ),
    // 樣式 1 是日期（內建的 numFmt 14）
    'xl/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    ),
  }
  sheetXml.forEach((xml, k) => (files[`xl/worksheets/sheet${k + 1}.xml`] = strToU8(xml)))
  files['xl/sharedStrings.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`,
  )
  return zipSync(files, { level: compress ? 6 : 0 })
}
