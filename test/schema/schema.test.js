import { describe, expect, it } from 'vitest'
import {
  createCitation,
  createGroup,
  createRecord,
  createSense,
  createValidators,
  formatErrors,
  parseRecordId,
  recordId,
} from '../../src/schema/index.js'

const validators = createValidators()

function sampleRecord(overrides = {}) {
  return createRecord(
    {
      source: 'pazih-dict',
      localId: 'p085-01',
      unit: 'word',
      text: 'baruzak',
      citation: createCitation('《巴宰語詞典》p.85 baruzak', { page: 85, pages: [85] }),
    },
    {
      dialects: ['pazeh'],
      senses: [createSense({ zh: '豬', en: 'pig (domesticated)' })],
      variants: [{ relation: '=', text: 'barudak', attribution: 'Ogawa' }],
      group: { id: 'pazih-dict:p085-01', role: 'head', parent: null, seq: 0 },
      quality: { status: 'reviewed', flags: [] },
      ...overrides,
    },
  )
}

describe('記錄 schema', () => {
  it('createRecord 產生的記錄可通過驗證', () => {
    const ok = validators.record(sampleRecord())
    expect(formatErrors(validators.record.errors)).toEqual([])
    expect(ok).toBe(true)
  })

  it('缺欄位或值域錯誤時驗證失敗，並給出可讀訊息', () => {
    const bad = sampleRecord({ unit: 'morpheme', dialects: ['xx'] })
    delete bad.notes
    expect(validators.record(bad)).toBe(false)
    const messages = formatErrors(validators.record.errors, bad.id)
    expect(messages.some((m) => m.includes('/unit'))).toBe(true)
    expect(messages.some((m) => m.includes('notes'))).toBe(true)
    expect(messages[0].startsWith('pazih-dict:p085-01：')).toBe(true)
  })

  it('方言代碼：schema 只規定格式，允許清單由站台設定注入', () => {
    // 沒有注入清單時，任何合格式的代碼都可以
    expect(validators.record(sampleRecord({ dialects: ['anything'] }))).toBe(true)
    expect(validators.record(sampleRecord({ dialects: ['Bad Code'] }))).toBe(false)
    // 注入清單後，清單外的代碼驗證失敗
    const strict = createValidators({ dialects: ['pazeh', 'kaxabu'] })
    expect(strict.record(sampleRecord({ dialects: ['pazeh'] }))).toBe(true)
    expect(strict.record(sampleRecord({ dialects: ['anything'] }))).toBe(false)
    // 注入不影響其他驗證器實例
    expect(validators.record(sampleRecord({ dialects: ['anything'] }))).toBe(true)
  })

  it('校對狀態只接受三級', () => {
    for (const status of ['unreviewed', 'reviewed', 'verified']) {
      expect(validators.record(sampleRecord({ quality: { status, flags: [] } }))).toBe(true)
    }
    expect(validators.record(sampleRecord({ quality: { status: 'draft', flags: [] } }))).toBe(false)
  })

  it('不允許未定義的欄位', () => {
    expect(validators.record({ ...sampleRecord(), extra: 1 })).toBe(false)
  })

  it('語料句的媒體與時間碼', () => {
    const record = sampleRecord({
      unit: 'sentence',
      media: [{ type: 'audio', src: 'media/x.mp3', start: null, end: null, available: true }],
      citation: createCitation('IMG_2659.MOV 01:12.56–01:13.60', {
        file: 'IMG_2659.MOV',
        timecode: { start: 72.56, end: 73.6 },
      }),
      interlinear: [{ form: 'ma-des', gloss: '狀態-久' }],
    })
    expect(validators.record(record)).toBe(true)
  })
})

describe('分片、群組與來源 schema', () => {
  it('分片可引用群組與記錄 schema', () => {
    const group = createGroup(
      { source: 'pazih-dict', localId: 'p085-01', type: 'entry', title: 'baruzak' },
      { citation: createCitation('《巴宰語詞典》p.85') },
    )
    const shard = { source: 'pazih-dict', shard: 'p085', label: 'p.85', groups: [group], records: [sampleRecord()] }
    expect(validators.shard(shard)).toBe(true)
  })

  it('來源後設資料', () => {
    const source = {
      id: 'demo',
      title: '示範',
      shortTitle: '示範',
      type: 'wordlist',
      description: null,
      authors: [],
      year: null,
      publisher: null,
      citation: null,
      url: null,
      license: null,
      defaultDialects: ['kaxabu'],
      orthography: null,
      browse: { mode: 'list', shardLabel: '頁' },
      reviewTracked: false,
      notes: [],
    }
    expect(validators.source(source)).toBe(true)
    expect(validators.source({ ...source, type: 'book' })).toBe(false)
    // reviewTracked 是必填：來源必須明確表態有沒有校對流程，不能靠預設值
    const { reviewTracked, ...withoutFlag } = source
    expect(validators.source(withoutFlag)).toBe(false)
  })
})

describe('輔助函式', () => {
  it('記錄 id 組合與拆解', () => {
    expect(recordId('kaxabu-classified', '01A-001')).toBe('kaxabu-classified:01A-001')
    expect(parseRecordId('pan-dexing-corpus:20200103-IMG_2659-01')).toEqual({
      source: 'pan-dexing-corpus',
      localId: '20200103-IMG_2659-01',
    })
    expect(() => parseRecordId('nocolon')).toThrow(RangeError)
  })

  it('createSense 把空字串轉成 null', () => {
    expect(createSense({ zh: ' 魚 ', en: '' })).toEqual({ zh: '魚', en: null, nan: null })
  })
})
