/**
 * @file Sub Station Alpha（.ssa／.ass）字幕解析。
 *
 * 語料的字幕格式：每個 Dialogue 的 Text 以 `\N` 分行，第一行是族語、其餘是中文翻譯。
 * 解析器依 [Events] 區段的 Format 行決定欄位順序，Text 永遠是最後一欄（可能含逗號）。
 */

/**
 * @typedef {object} SsaEvent
 * @property {number} start 起始秒數
 * @property {number} end 結束秒數
 * @property {string} speaker Name 欄位
 * @property {string[]} lines Text 以 \N 分出的各行（已去除 {\…} 樣式碼）
 * @property {Record<string, string>} fields 原始欄位
 */

/**
 * @param {string} content 檔案內容
 * @returns {{info: Record<string, string>, events: SsaEvent[]}}
 */
export function parseSsa(content) {
  const text = content.replace(/^﻿/u, '')
  /** @type {Record<string, string>} */
  const info = {}
  /** @type {SsaEvent[]} */
  const events = []
  let section = ''
  /** @type {string[] | null} */
  let format = null

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';')) continue

    const header = /^\[(.+)\]$/u.exec(line)
    if (header) {
      section = header[1].toLowerCase()
      format = null
      continue
    }

    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()

    if (section === 'script info') {
      info[key] = value
    } else if (section === 'events') {
      if (key === 'Format') {
        format = value.split(',').map((f) => f.trim())
      } else if (key === 'Dialogue' && format) {
        const parts = splitFields(value, format.length)
        /** @type {Record<string, string>} */
        const fields = {}
        format.forEach((name, k) => (fields[name] = parts[k] ?? ''))
        events.push({
          start: parseTimecode(fields.Start),
          end: parseTimecode(fields.End),
          speaker: fields.Name ?? '',
          lines: (fields.Text ?? '')
            .replace(/\{[^}]*\}/gu, '')
            .split(/\\N|\\n/u)
            .map((s) => s.trim())
            .filter(Boolean),
          fields,
        })
      }
    }
  }

  events.sort((a, b) => a.start - b.start)
  return { info, events }
}

/**
 * 以逗號切成 count 欄，最後一欄保留剩餘所有內容。
 * @param {string} value
 * @param {number} count
 */
function splitFields(value, count) {
  const parts = []
  let rest = value
  for (let k = 0; k < count - 1; k++) {
    const comma = rest.indexOf(',')
    if (comma < 0) break
    parts.push(rest.slice(0, comma).trim())
    rest = rest.slice(comma + 1)
  }
  parts.push(rest.trim())
  return parts
}

/**
 * `H:MM:SS.cc` → 秒數。
 * @param {string | undefined} value
 */
export function parseTimecode(value) {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/u.exec(value ?? '')
  if (!m) throw new RangeError(`無法解析的時間碼：${value}`)
  const fraction = m[4] ? Number(m[4]) / 10 ** m[4].length : 0
  return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + fraction) * 1000) / 1000
}

/**
 * 秒數 → `MM:SS.cc`（超過一小時則為 `H:MM:SS.cc`）。
 * @param {number} seconds
 */
export function formatTimecode(seconds) {
  const totalCentis = Math.round(seconds * 100)
  const h = Math.floor(totalCentis / 360000)
  const m = Math.floor((totalCentis % 360000) / 6000)
  const s = Math.floor((totalCentis % 6000) / 100)
  const cs = totalCentis % 100
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
  return h > 0 ? `${h}:${mmss}` : mmss
}
