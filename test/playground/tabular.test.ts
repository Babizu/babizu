/**
 * 展示版的詞表匯入（src/playground/tabular.ts）：剖析 CSV、TSV，猜欄位用途，方言值對到變體，轉成專案的詞與例句。
 */

import { describe, expect, it } from 'vitest'
import { detectDelimiter, guessRoles, matchDialects, parseTable, suggestVarietyCode, tableToSentences, tableToWords } from '../../src/playground/tabular.ts'

const VARIETIES = [
  { code: 'north', label: { 'zh-TW': '北部', en: 'Northern' } },
  { code: 'south', label: '南部' },
]

describe('剖析表格', () => {
  it('判斷分隔符號：有 tab 是 TSV，否則逗號或分號（較多的那個）', () => {
    expect(detectDelimiter('a\tb\nc')).toBe('\t')
    expect(detectDelimiter('a,b,c')).toBe(',')
    expect(detectDelimiter('a;b;c,d')).toBe(';')
    expect(detectDelimiter('﻿a\tb')).toBe('\t')
  })

  it('RFC 4180：引號包住的欄位可以有逗號與換行，"" 是一個引號；去掉 BOM、空白列、前後空白；CRLF 與 LF 都可以', () => {
    const csv = '﻿詞,中文\r\n"a,b","說""你好""\n第二行"\r\n\r\n , \r\nc ,d\n'
    expect(parseTable(csv)).toEqual([
      ['詞', '中文'],
      ['a,b', '說"你好"\n第二行'],
      ['c', 'd'],
    ])
  })

  it('從試算表貼上的文字（tab 分隔）；最後一列沒有換行也收', () => {
    expect(parseTable('ralan\t路\nlalan\t路')).toEqual([
      ['ralan', '路'],
      ['lalan', '路'],
    ])
  })

  it('每格正規化成 NFC', () => {
    expect(parseTable('é')[0][0]).toBe('é')
  })
})

describe('欄位與方言', () => {
  it('依表頭猜用途（中英文都認得；同一種用途只給第一欄）', () => {
    expect(guessRoles(['Word', '中文', 'English', '方言', '詞類', '其他寫法', '備註', '頁碼', '詞'])).toEqual(['text', 'zh', 'en', 'dialect', 'pos', 'alt', 'note', 'ignore', 'ignore'])
  })

  it('方言值可以是代碼或任何語系的名稱，可以有幾個；對不到的另外列出', () => {
    expect(matchDialects('north、南部 / Northern; 山區', VARIETIES)).toEqual({ codes: ['north', 'south'], unknown: ['山區'] })
  })

  it('新變體的代碼：名稱本身合格就用它，否則 v1、v2…', () => {
    expect(suggestVarietyCode('Coast', [])).toBe('coast')
    expect(suggestVarietyCode('山區', ['v1'])).toBe('v2')
    expect(suggestVarietyCode('north', ['north'])).toBe('v1')
  })
})

describe('轉成專案的詞與例句', () => {
  const table = parseTable('詞\t中文\t英文\t方言\t其他寫法\n ralan \t路\troad\tnorth\tralang, rallan\n\t空的\t\t\t\nbatu\t石頭\tstone\t山區\t')
  const roles = guessRoles(table[0])

  it('詞：編號接著已用過的；沒有詞形的列略過；方言對不到的列出', () => {
    const r = tableToWords(table, roles, { hasHeader: true, varieties: VARIETIES, usedIds: ['w1', 'w2'] })
    expect(r.skipped).toBe(1)
    expect(r.unknownDialects).toEqual(['山區'])
    expect(r.rows).toEqual([
      { id: 'w3', text: 'ralan', zh: '路', en: 'road', dialects: ['north'], pos: '', alt: ['ralang', 'rallan'], note: '' },
      { id: 'w4', text: 'batu', zh: '石頭', en: 'stone', dialects: [], pos: '', alt: [], note: '' },
    ])
  })

  it('例句：編號 s1、s2…，只取句子、中英文與方言', () => {
    const r = tableToSentences([['ma-ruza a tamoh', '水在流', 'north']], ['text', 'zh', 'dialect'], { hasHeader: false, varieties: VARIETIES })
    expect(r.rows).toEqual([{ id: 's1', text: 'ma-ruza a tamoh', zh: '水在流', en: '', dialects: ['north'], note: '' }])
  })
})
