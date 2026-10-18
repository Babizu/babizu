/**
 * @file 不壓縮（stored）的 zip 檔：展示版匯出網站起始包用。不加套件；檔名以 UTF-8 寫出（設定 EFS 旗標）。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * 把幾個檔案包成 zip。
 * @param files 路徑（以 / 分隔）→ 內容（字串以 UTF-8 寫出）
 */
export function createZip(files: Array<[string, string | Uint8Array]>): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [path, content] of files) {
    const name = enc.encode(path)
    const data = typeof content === 'string' ? enc.encode(content) : content
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // 需要的版本
    lv.setUint16(6, 0x0800, true) // UTF-8 檔名
    lv.setUint16(8, 0, true) // stored
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const header = new Uint8Array(46 + name.length)
    const hv = new DataView(header.buffer)
    hv.setUint32(0, 0x02014b50, true)
    hv.setUint16(4, 20, true)
    hv.setUint16(6, 20, true)
    hv.setUint16(8, 0x0800, true)
    hv.setUint16(10, 0, true)
    hv.setUint32(16, crc, true)
    hv.setUint32(20, data.length, true)
    hv.setUint32(24, data.length, true)
    hv.setUint16(28, name.length, true)
    hv.setUint32(42, offset, true)
    header.set(name, 46)
    chunks.push(local, data)
    central.push(header)
    offset += local.length + data.length
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + centralSize + end.length)
  let at = 0
  for (const c of [...chunks, ...central, end]) {
    out.set(c, at)
    at += c.length
  }
  return out
}
