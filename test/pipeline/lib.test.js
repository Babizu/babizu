import { describe, expect, it } from 'vitest'
import { extractInterlinearBlocks, parseDocumentXml } from '../../src/pipeline/docx.js'
import { isBlank, orNull } from '../../src/pipeline/spreadsheet.js'
import { formatTimecode, parseSsa, parseTimecode } from '../../src/pipeline/ssa.js'
import { classifyUnit } from '../../src/pipeline/unit.js'

describe('classifyUnit', () => {
  it('黏著形式與體例符號判為詞綴', () => {
    expect(classifyUnit('a-', { formType: 'bound-initial', role: 'head' })).toBe('affix')
    expect(classifyUnit('<in>', { formType: 'infix' })).toBe('affix')
    expect(classifyUnit('-an')).toBe('affix')
    expect(classifyUnit('sa-', { role: 'item' })).toBe('affix')
  })

  it('例句與語料句：句末標點或 3 詞以上為句子', () => {
    expect(classifyUnit('kizui!', { role: 'example' })).toBe('sentence')
    expect(classifyUnit('baruzak binayu', { role: 'example' })).toBe('phrase')
    expect(classifyUnit('ini a saw ka', { role: 'segment' })).toBe('sentence')
    expect(classifyUnit('tamako', { role: 'segment' })).toBe('word')
  })

  it('詞條與清單項目：多詞為片語，不判為句子', () => {
    expect(classifyUnit('baruzak binayu', { role: 'item' })).toBe('phrase')
    expect(classifyUnit('punu', { role: 'item' })).toBe('word')
    expect(classifyUnit('maatu-batan', { formType: 'free', role: 'form' })).toBe('word')
  })
})

describe('SSA 字幕', () => {
  const ssa = [
    '﻿[Script Info]',
    'Title: IMG_0001',
    '',
    '[Events]',
    'Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: Marked=0,0:01:28.67,0:01:31.69,*Default,潘德興,0000,0000,0000,,mades ini mikita imu\\N很久沒看到你們了',
    'Dialogue: Marked=0,0:01:12.56,0:01:13.60,*Default,潘德興,0000,0000,0000,,{\\i1}palizak ka, asiki a punu{\\i0}\\N曬太陽，會頭痛',
  ].join('\r\n')

  it('依 Format 解析欄位、依時間排序、Text 可含逗號', () => {
    const { info, events } = parseSsa(ssa)
    expect(info.Title).toBe('IMG_0001')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ start: 72.56, end: 73.6, speaker: '潘德興' })
    expect(events[0].lines).toEqual(['palizak ka, asiki a punu', '曬太陽，會頭痛'])
    expect(events[1].lines[0]).toBe('mades ini mikita imu')
  })

  it('時間碼雙向轉換', () => {
    expect(parseTimecode('1:02:03.45')).toBe(3723.45)
    expect(formatTimecode(72.56)).toBe('01:12.56')
    expect(formatTimecode(3723.45)).toBe('1:02:03.45')
    expect(() => parseTimecode('abc')).toThrow(RangeError)
  })
})

describe('docx 逐詞對譯', () => {
  const p = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
  const row = (cells) => `<w:tr>${cells.map((c) => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`
  const table = (rows) => `<w:tbl>${rows.map(row).join('')}</w:tbl>`
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    ${p('IMG_2659.MOV')}
    ${p('音檔檔名：IMG_2659_1_tamako.mp3')}
    ${p('tamako')}
    ${table([['tamako'], ['斗笠']])}
    ${p('「斗笠」')}
    ${p('IMG_2670.MOV')}
    ${p('palizak ka paka, asiki a punu')}
    ${table([['pa-lizak', 'ka'], ['使役-曬太陽', '主題標記'], ['asiki=a', ''], ['=連', '']])}
    ${p('「曬太陽會頭痛」')}
    ${p('')}
  </w:body></w:document>`

  it('依順序輸出段落與表格', () => {
    const elements = parseDocumentXml(xml)
    expect(elements.filter((e) => e.type === 'table')).toHaveLength(2)
    expect(elements[0]).toEqual({ type: 'paragraph', text: 'IMG_2659.MOV' })
  })

  it('抽出每句的影片、音檔、句子、對譯與翻譯；多組表格列合併', () => {
    const blocks = extractInterlinearBlocks(parseDocumentXml(xml))
    expect(blocks).toEqual([
      {
        video: 'IMG_2659.MOV',
        audioFile: 'IMG_2659_1_tamako.mp3',
        text: 'tamako',
        pairs: [{ form: 'tamako', gloss: '斗笠' }],
        translation: '斗笠',
      },
      {
        video: 'IMG_2670.MOV',
        audioFile: null,
        text: 'palizak ka paka, asiki a punu',
        pairs: [
          { form: 'pa-lizak', gloss: '使役-曬太陽' },
          { form: 'ka', gloss: '主題標記' },
          { form: 'asiki=a', gloss: '=連' },
        ],
        translation: '曬太陽會頭痛',
      },
    ])
  })
})

describe('試算表工具', () => {
  it('空值判定', () => {
    expect(isBlank('---')).toBe(true)
    expect(isBlank('')).toBe(true)
    expect(isBlank('a-')).toBe(false)
    expect(orNull('---')).toBeNull()
    expect(orNull('noun')).toBe('noun')
  })
})
