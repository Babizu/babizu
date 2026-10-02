/**
 * 句型搜尋的切詞（src/pattern/sentences.js）：分句、原文位置、語法書的體例。
 */

import { describe, expect, it } from 'vitest'
import { MAX_READINGS, segmentText } from '../../src/pattern/sentences.js'
import { createTextTools } from '../../src/search/text.js'
import { PAZEH_PROFILE } from '../fixtures/pazeh.js'

const { searchKey, splitWords } = createTextTools(PAZEH_PROFILE)
/** 每一句的各種讀法，寫成「詞 詞 詞」 @param {string} text */
const readings = (text) => segmentText(text, searchKey).segments.map((rs) => rs.map((r) => r.map((t) => t.key).join(' ')))

describe('切詞與分句', () => {
  it('與索引的斷詞相同：標點分開，體例符號（- = ~）從搜尋鍵刪除', () => {
    expect(readings('ata\'-i! talubik-ay, "mukawas" yaku')).toEqual([["ata'i"], ["talubikay mukawas yaku"]])
    // 沒有語法書體例的句子，依序就是索引的整詞（splitWords）；彎撇號與直撇號相同
    for (const text of ['yaku ka maha isiw usa humak.', 'imini ka kaidi tshay=a akhéhan?', 'pakahatiken’ina! ana halupas!', 'mades ini mikita imu']) {
      const keys = segmentText(text, searchKey).segments.flatMap((rs) => rs[0].map((t) => t.key))
      expect(keys, text).toEqual(splitWords(text))
    }
    expect(readings('pakahatiken’ina!')).toEqual([["pakahatiken'ina"]])
  })

  it('句末標點（. ? ! 與全形）分句；逗號不分', () => {
    expect(readings('pinakita ki saw. yaku ka isiw')).toEqual([['pinakita ki saw'], ['yaku ka isiw']])
    expect(readings('ima liao? haka mupuza。 yaku, isiw!')).toEqual([['ima liao'], ['haka mupuza'], ['yaku isiw']])
  })

  it('原文位置：每個詞在原文中的範圍（高亮用）', () => {
    const text = '“isiw” ka, mupuza.'
    const [[r]] = segmentText(text, searchKey).segments
    expect(r.map((t) => text.slice(t.start, t.end))).toEqual(['isiw', 'ka', 'mupuza'])
  })
})

describe('語法書的體例（林鴻瑞《噶哈巫語參考語法》）', () => {
  it('(ka)：可以省略 → 兩種讀法（先列有的）', () => {
    expect(readings('yaku (ka) mupuza lia.')).toEqual([['yaku ka mupuza lia', 'yaku mupuza lia']])
  })

  it('iu/*maki：擇一，* 的選項不合語法、不參與', () => {
    expect(readings('yaku nahaza mama iu/*maki iah.')).toEqual([['yaku nahaza mama iu iah']])
    expect(readings('isiw iu/maki yaku')).toEqual([['isiw iu yaku', 'isiw maki yaku']])
  })

  it('*(ki)：不能省略 → 照常；詞中的括號：字母可有可無', () => {
    expect(readings('paidem *(ki) rakihan!')).toEqual([['paidem ki rakihan']])
    expect(readings('ma(a)sikakialah')).toEqual([['maasikakialah', 'masikakialah']])
  })

  it('原文位置指向選中的那一種寫法', () => {
    const text = 'mama iu/*maki iah'
    const [[r]] = segmentText(text, searchKey).segments
    expect(r.map((t) => text.slice(t.start, t.end))).toEqual(['mama', 'iu', 'iah'])
  })

  it(`組合超過 ${MAX_READINGS} 種時只用第一種（可省略的都保留、擇一取第一個）`, () => {
    const text = Array.from({ length: 5 }, (_, k) => `(w${'a'.repeat(k + 1)})`).join(' ')
    expect(readings(text)).toEqual([['wa waa waaa waaaa waaaaa']])
  })
})
