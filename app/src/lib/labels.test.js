import { describe, expect, it } from 'vitest'
import { setLocale } from '@/i18n.js'
import {
  dialectLabel,
  formatDistance,
  formatMorphStep,
  formatStep,
  formatTimecode,
  morphGloss,
  morphSummary,
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

  it('構詞步驟與摘要：依詞形中的位置排列', () => {
    expect(formatMorphStep({ type: 'prefix', form: 'mu' })).toBe('mu-')
    expect(formatMorphStep({ type: 'suffix', form: 'an' })).toBe('-an')
    expect(formatMorphStep({ type: 'infix', form: 'in' })).toBe('<in>')
    expect(formatMorphStep({ type: 'alternation', form: 't>d' })).toBe('t→d')
    // steps 由外而內：mu- 最外層、-an 次之、pa- 最內層
    const steps = [
      { type: 'prefix', form: 'mu' },
      { type: 'suffix', form: 'an' },
      { type: 'prefix', form: 'pa' },
      { type: 'suffix', form: 'i' },
    ]
    expect(morphSummary({ stem: 'tuku', steps })).toBe('mu- + pa- + tuku + -i + -an')
  })

  it('構詞文法的組合：依詞素寫出，落在前綴上的中綴插在前綴的首輔音之後', () => {
    const p = (/** @type {string} */ type, /** @type {string} */ form) => ({ type, form })
    // M<a>…-ay：m- 之後插入 <a>，再加 -ay
    const irr = { type: 'circumfix', form: 'ma…ay', left: { type: 'prefix', form: 'ma' }, suffix: 'ay', parts: [p('prefix', 'm'), p('infix', 'a'), p('suffix', 'ay')] }
    expect(formatMorphStep(irr)).toBe('m<a>-…-ay')
    expect(morphSummary({ stem: 'usa', steps: [irr] })).toBe('m<a>- + usa + -ay')
    // m<in>u-：只有前綴的組合規則，沒有右邊
    const prf = { type: 'circumfix', form: 'minu', left: { type: 'prefix', form: 'minu' }, suffix: '', parts: [p('prefix', 'mu'), p('infix', 'in')] }
    expect(formatMorphStep(prf)).toBe('m<in>u-')
    expect(morphSummary({ stem: 'baket', steps: [prf] })).toBe('m<in>u- + baket')
    // <in>…-an：詞根上的中綴，放在詞根旁
    const lf = { type: 'circumfix', form: 'in…an', left: { type: 'infix', form: 'in' }, suffix: 'an', parts: [p('infix', 'in'), p('suffix', 'an')] }
    expect(morphSummary({ stem: 'baket', steps: [lf] })).toBe('baket + <in> + -an')
    // 只有一側的組合規則展開成的前綴（k<a>a-）在前綴鏈中：與其他前綴一起依位置排列
    expect(morphSummary({ stem: 'baket', steps: [{ type: 'prefix', form: 'kaa', parts: [p('prefix', 'ka'), p('infix', 'a')] }] })).toBe('k<a>a- + baket')
  })

  it('平面清單的包覆單位（沒有 parts）：外側的前綴在詞幹前、中綴在詞幹旁；沒有後綴時不寫「…」', () => {
    const wrap = { type: 'circumfix', form: 'm+a…ay', left: { type: 'infix', form: 'a' }, outer: 'm', suffix: 'ay' }
    expect(formatMorphStep(wrap)).toBe('m-<a>…-ay')
    expect(morphSummary({ stem: 'baket', steps: [wrap] })).toBe('m- + baket + <a> + -ay')
    const vowelStem = { type: 'circumfix', form: 'ma', left: { type: 'prefix', form: 'ma' }, suffix: '' }
    expect(formatMorphStep(vowelStem)).toBe('ma-')
    expect(morphSummary({ stem: 'usa', steps: [vowelStem] })).toBe('ma- + usa')
  })

  it('詞綴說明依介面語系', () => {
    setLocale('en')
    expect(morphGloss({ 'zh-TW': '主事焦點', en: 'AF' })).toBe('AF')
    setLocale('zh-TW')
    expect(morphGloss({ 'zh-TW': '主事焦點', en: 'AF' })).toBe('主事焦點')
    expect(morphGloss(null)).toBe('')
  })
})
