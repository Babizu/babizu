import { describe, expect, it } from 'vitest'
import { createNormalizer } from '../../src/fuzzy/index.js'

describe('createNormalizer', () => {
  it('預設：NFC、小寫、撇號統一、空白整理', () => {
    const normalize = createNormalizer()
    expect(normalize('  Pubatu’i  ')).toBe("pubatu'i")
    expect(normalize('a  \t b')).toBe('a b')
    expect(normalize('é')).toBe('é')
  })

  it('去附加符號時保留指定字元', () => {
    const normalize = createNormalizer({ stripDiacritics: true, preserve: ['é'] })
    expect(normalize('mākākāwāsa͡i')).toBe('makakawasai')
    expect(normalize('pù nu')).toBe('pu nu')
    expect(normalize('akhéhan')).toBe('akhéhan')
  })

  it('removeChars 刪除指定字元', () => {
    const normalize = createNormalizer({ removeChars: '-<>' })
    expect(normalize('ma-<in>des')).toBe('maindes')
  })

  it('處理 null／undefined', () => {
    expect(createNormalizer()(undefined)).toBe('')
  })
})
