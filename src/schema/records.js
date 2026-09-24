/**
 * @file 建立標準記錄的輔助函式。
 *
 * 轉接器只需要填自己有的欄位，其餘欄位由這裡補上一致的空值（null 或 []），
 * 確保每筆輸出都有完整欄位、能通過 schema 驗證。
 */

import { recordId } from './constants.js'

/**
 * 建立空白出處。
 * @param {string} label
 * @param {Partial<import('./types.js').Citation>} [fields]
 * @returns {import('./types.js').Citation}
 */
export function createCitation(label, fields = {}) {
  return {
    label,
    page: null,
    pages: [],
    row: null,
    code: null,
    file: null,
    timecode: null,
    scan: null,
    ...fields,
  }
}

/**
 * 建立一筆標準記錄。
 *
 * @param {object} fields
 * @param {string} fields.source
 * @param {string} fields.localId
 * @param {import('./types.js').Unit} fields.unit
 * @param {string} fields.text
 * @param {import('./types.js').Citation} fields.citation
 * @param {Partial<import('./types.js').CorpusRecord>} [rest] 其餘欄位
 * @returns {import('./types.js').CorpusRecord}
 *
 * @example
 * createRecord({ source: 'demo', localId: 'r1', unit: 'word', text: 'alaw',
 *   citation: createCitation('示範 第 1 列', { row: 1 }) }, { senses: [{ zh: '魚', en: null, nan: null }] })
 */
export function createRecord(fields, rest = {}) {
  const { source, localId, unit, text, citation } = fields
  return {
    id: recordId(source, localId),
    source,
    localId,
    unit,
    text,
    altTexts: [],
    dialects: [],
    dialectRaw: null,
    senses: [],
    pos: null,
    domain: null,
    morphology: null,
    interlinear: [],
    variants: [],
    related: [],
    group: null,
    citation,
    media: [],
    attribution: null,
    speaker: null,
    quality: { status: 'unreviewed', flags: [] },
    notes: [],
    ...rest,
  }
}

/**
 * 建立一個群組。
 * @param {Pick<import('./types.js').CorpusGroup, 'source' | 'type' | 'title'> & {localId: string}} fields
 * @param {Partial<import('./types.js').CorpusGroup>} [rest]
 * @returns {import('./types.js').CorpusGroup}
 */
export function createGroup(fields, rest = {}) {
  const { source, localId, type, title } = fields
  return {
    id: recordId(source, localId),
    source,
    type,
    title,
    subtitle: null,
    citation: null,
    media: [],
    ...rest,
  }
}

/**
 * 建立一個義項；空字串會轉成 null。
 * @param {{zh?: string | null, en?: string | null, nan?: string | null, note?: string | null}} parts
 * @returns {import('./types.js').Sense}
 */
export function createSense({ zh = null, en = null, nan = null, note } = {}) {
  const clean = (/** @type {string | null | undefined} */ v) => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s === '' ? null : s
  }
  /** @type {import('./types.js').Sense} */
  const sense = { zh: clean(zh), en: clean(en), nan: clean(nan) }
  if (note !== undefined) sense.note = clean(note)
  return sense
}
