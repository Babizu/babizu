import { describe, expect, it } from 'vitest'
import { createNormalizer, normalizerOptionsFromProfile } from '../../src/fuzzy/index.js'
import { PAZEH_PROFILE } from '../fixtures/pazeh.js'
import { createRandom, randomString } from './helpers.js'

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

  it('冪等：已正規化的字串再正規化一次不變（預設與巴宰語設定檔；language-profile.md「normalizer」）', () => {
    const options = normalizerOptionsFromProfile(PAZEH_PROFILE)
    // 大小寫、組合附加符號、各種撇號與空白，加上設定檔 charMap 的每個來源字元
    const alphabet = ['a', 'A', 'é', 'É', 'e\u0301', 'u\u0304', ' ', '\t', '\u00a0', '’', "'", 'ŋ', '-', ...Object.keys(options.charMap)]
    for (const normalize of [createNormalizer(), createNormalizer(options)]) {
      const random = createRandom(4242)
      for (let k = 0; k < 2000; k++) {
        const once = normalize(randomString(random, alphabet, 0, 8))
        expect(normalize(once), once).toBe(once)
      }
    }
  })

  it('charMap 寫成反向的連鎖時不冪等（language-profile.md 要求不要這樣寫）', () => {
    // 依序套用：b → c 先做，a → b 後做，a 只走了一步
    const normalize = createNormalizer({ charMap: { b: 'c', a: 'b' } })
    expect(normalize('a')).toBe('b')
    expect(normalize(normalize('a'))).toBe('c')
  })
})
