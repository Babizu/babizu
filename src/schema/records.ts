/**
 * @file 建立標準記錄的輔助函式。
 *
 * 轉接器只需要填自己有的欄位，其餘欄位由這裡補上一致的空值（null 或 []），
 * 確保每筆輸出都有完整欄位、能通過 schema 驗證。
 */

import { recordId } from './constants.ts'
import type { Citation, CorpusGroup, CorpusRecord, Sense, Unit } from './types.ts'

/** 建立空白出處。 */
export function createCitation(label: string, fields: Partial<Citation> = {}): Citation {
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
 * @param rest 其餘欄位
 *
 * @example
 * createRecord({ source: 'demo', localId: 'r1', unit: 'word', text: 'alaw',
 *   citation: createCitation('示範 第 1 列', { row: 1 }) }, { senses: [{ zh: '魚', en: null, nan: null }] })
 */
export function createRecord(
  fields: { source: string; localId: string; unit: Unit; text: string; citation: Citation },
  rest: Partial<CorpusRecord> = {},
): CorpusRecord {
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

/** 建立一個群組。 */
export function createGroup(fields: Pick<CorpusGroup, 'source' | 'type' | 'title'> & { localId: string }, rest: Partial<CorpusGroup> = {}): CorpusGroup {
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

/** 建立一個義項；空字串會轉成 null。 */
export function createSense({ zh = null, en = null, nan = null, note }: { zh?: string | null; en?: string | null; nan?: string | null; note?: string | null } = {}): Sense {
  const clean = (v: string | null | undefined) => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s === '' ? null : s
  }
  const sense: Sense = { zh: clean(zh), en: clean(en), nan: clean(nan) }
  if (note !== undefined) sense.note = clean(note)
  return sense
}
