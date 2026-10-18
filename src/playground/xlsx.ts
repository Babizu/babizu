/**
 * @file 讀 Excel 活頁簿（.xlsx）的第一張工作表成表格。不加套件：
 * - .xlsx 是 zip：讀中央目錄，deflate 的檔以內建的 DecompressionStream('deflate-raw') 解壓（瀏覽器與 Node 18+ 都有）；
 * - 只讀需要的 XML（workbook、rels、sharedStrings、第一張工作表），以正規表示式取值（格式固定，不需要完整的 XML 剖析器）。
 * 支援共用字串、行內字串、數字與公式的快取值；合併儲存格只有左上角有值。
 */

/** zip 裡的一個檔 */
interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  offset: number
}

function readEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // 中央目錄結尾記錄：從檔尾往前找簽名
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('not a zip file')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const dec = new TextDecoder()
  const entries: ZipEntry[] = []
  for (let k = 0; k < count; k++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('broken zip directory')
    const method = view.getUint16(at + 10, true)
    const compressedSize = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const offset = view.getUint32(at + 42, true)
    entries.push({ name: dec.decode(bytes.subarray(at + 46, at + 46 + nameLength)), method, compressedSize, offset })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true)
  const data = bytes.slice(start, start + entry.compressedSize)
  if (entry.method === 0) return new TextDecoder().decode(data)
  if (entry.method !== 8) throw new Error(`unsupported zip compression ${entry.method}`)
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

/** 解開 zip 裡所有的檔（以 UTF-8 文字讀；測試與除錯用） */
export async function unzipText(bytes: Uint8Array): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const e of readEntries(bytes)) out.set(e.name, await readEntry(bytes, e))
  return out
}

const ENTITIES: Record<string, string> ={ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ENTITIES[e] ?? m
  })
}

/** 一段 XML 中所有 <t> 的文字接起來（共用字串、行內字串的格式化片段都在 <t> 裡） */
function textOf(xml: string): string {
  let out = ''
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)) out += unescapeXml(m[1])
  return out
}

/** 欄名（A、B、…、AA）→ 欄位索引 */
function columnIndex(ref: string): number {
  let n = 0
  for (const c of ref.replace(/\d+$/u, '').toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64)
  return n - 1
}

/**
 * 讀第一張工作表。
 * @returns 表格（去掉全空白的列；每格去掉前後空白、正規化成 NFC）
 */
export async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const entries = readEntries(bytes)
  const file = async (name: string) => {
    const e = entries.find((x) => x.name === name)
    return e ? readEntry(bytes, e) : null
  }
  // 第一張工作表的位置：workbook.xml 的第一個 <sheet> → rels 的 Target
  let sheetPath = 'xl/worksheets/sheet1.xml'
  const workbook = await file('xl/workbook.xml')
  const rels = await file('xl/_rels/workbook.xml.rels')
  const rid = workbook?.match(/<sheet\b[^>]*\br:id="([^"]+)"/u)?.[1]
  if (rid && rels) {
    const target = rels.match(new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*\\bTarget="([^"]+)"`, 'u'))?.[1] ?? rels.match(new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${rid}"`, 'u'))?.[1]
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//u, '')}`
  }
  const sheet = await file(sheetPath)
  if (!sheet) throw new Error('no worksheet found')
  const sharedXml = (await file('xl/sharedStrings.xml')) ?? ''
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/gu)].map((m) => textOf(m[1]))

  const rows: string[][] = []
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)) {
    const row: string[] = []
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
      const attrs = c[1]
      const body = c[2] ?? ''
      const ref = attrs.match(/\br="([A-Z]+\d+)"/u)?.[1]
      const type = attrs.match(/\bt="([^"]+)"/u)?.[1]
      const v = body.match(/<v>([\s\S]*?)<\/v>/u)?.[1]
      let value = ''
      if (type === 's') value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') value = textOf(body)
      else if (v !== undefined) value = unescapeXml(v)
      const index = ref ? columnIndex(ref) : row.length
      while (row.length < index) row.push('')
      row[index] = value.normalize('NFC').trim()
    }
    if (row.some((x) => x !== '')) rows.push(row)
  }
  return rows
}
