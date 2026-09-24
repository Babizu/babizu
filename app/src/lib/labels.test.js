import { describe, expect, it } from 'vitest'
import { setLocale } from '@/i18n.js'
import {
  dialectLabel,
  formatDistance,
  formatStep,
  formatTimecode,
  orderedVarieties,
  recordRoute,
  unitLabel,
  writingSystemLabel,
} from './labels.js'

describe('labels', () => {
  it('距離格式：最多兩位小數', () => {
    expect(formatDistance(0.30000000000000004)).toBe('0.3')
    expect(formatDistance(1)).toBe('1')
    expect(formatDistance(Infinity)).toBe('∞')
  })

  it('對齊步驟：空字串顯示為 ∅', () => {
    expect(formatStep({ source: 'r', target: '' })).toBe('r→∅')
    expect(formatStep({ source: '', target: 'h' })).toBe('∅→h')
  })

  it('時間碼', () => {
    expect(formatTimecode(88.67)).toBe('01:28.67')
  })

  it('名稱依介面語系：方言來自站台設定，單位來自語系字串', () => {
    setLocale('zh-TW')
    expect(dialectLabel('kaxabu')).toBe('噶哈巫')
    expect(unitLabel('word')).toBe('詞')
    expect(writingSystemLabel('pan-yongli')).toBe('潘永歷標記法')
    setLocale('en')
    expect(dialectLabel('kaxabu')).toBe('Kaxabu')
    expect(unitLabel('word')).toBe('Word')
    // 站台沒設定、框架也沒有的代碼：原樣顯示
    expect(dialectLabel('xx')).toBe('xx')
    expect(writingSystemLabel('unknown-system')).toBe('unknown-system')
    setLocale('zh-TW')
  })

  it('變體排序：下層緊接在上層之後', () => {
    expect(orderedVarieties().map((v) => v.code)).toEqual(['pazeh', 'auran', 'kaxabu'])
  })

  it('記錄路由（localId 可含冒號以外的任意字元）', () => {
    expect(recordRoute('pan-dexing-wordlist:pos-動')).toEqual({
      name: 'record',
      params: { source: 'pan-dexing-wordlist', localId: 'pos-動' },
    })
  })
})
