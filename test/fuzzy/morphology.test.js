/**
 * 構詞分析：去詞綴（analyze）與還原詞綴（generate）。
 * 規格是合成的，只用來驗證機制；真實語言的詞綴清單屬於各站台的語言設定檔。
 */

import { describe, expect, it } from 'vitest'
import { createAnalyzer, validateMorphology, validateProfile } from '../../src/fuzzy/index.js'

const SPEC = {
  cost: 0.3,
  minStem: 3,
  maxSteps: 3,
  prefixes: [{ form: 'mu', gloss: { 'zh-TW': '主事焦點', en: 'AF' } }, { form: 'pa' }, { form: 'ka' }],
  suffixes: [{ form: 'an' }, { form: 'en' }, { form: 'un' }],
  infixes: [{ form: 'in' }, { form: 'a' }],
  reduplication: [{ pattern: 'Ca' }],
  alternations: [{ underlying: 't', surface: 'd', before: ['an', 'un'] }],
}
const analyzer = createAnalyzer(SPEC)
const stems = (/** @type {string} */ w) => analyzer.analyze(w).map((a) => a.stem)

describe('analyze：去詞綴', () => {
  it('前綴、後綴、前後綴', () => {
    expect(stems('mudaux')).toContain('daux')
    expect(stems('tukuan')).toContain('tuku')
    expect(stems('mupatukuan')).toEqual(expect.arrayContaining(['patukuan', 'tukuan', 'tuku']))
  })

  it('中綴：首輔音之後、首元音之前', () => {
    const a = analyzer.analyze('binaket').find((x) => x.stem === 'baket')
    expect(a?.steps).toEqual([expect.objectContaining({ type: 'infix', form: 'in' })])
    // 拿掉中綴後首輔音後面接的不是元音 → 不是中綴（還原時位置會不一致）
    expect(stems('tinsak')).not.toContain('tsak')
  })

  it('Ca 重疊：詞幹首輔音＋a；元音開頭的詞幹只重疊 a', () => {
    expect(analyzer.analyze('sasuzuk').find((x) => x.stem === 'suzuk')?.steps[0]).toMatchObject({
      type: 'reduplication',
      form: 'sa',
      pattern: 'Ca',
    })
    expect(stems('aalep')).toContain('alep')
  })

  it('詞幹交替只發生在指定的後綴前', () => {
    const a = analyzer.analyze('bitudun').find((x) => x.stem === 'bitut')
    expect(a?.steps.map((s) => s.type)).toEqual(['suffix', 'alternation'])
    expect(a?.cost).toBeCloseTo(0.6)
    // -en 不在 before 清單中：只剝後綴，不還原 t
    expect(stems('bitudén')).not.toContain('bitut')
  })

  it('詞幹最短長度與層數上限', () => {
    expect(stems('muan')).toEqual([]) // 剝掉後只剩 2 個字元
    const deep = analyzer.analyze('mupakabinaketan')
    expect(deep.every((a) => a.steps.length <= 3)).toBe(true)
  })

  it('同一個詞幹只保留成本最低的分析，依成本排序', () => {
    const list = analyzer.analyze('mupatukuan')
    expect(new Set(list.map((a) => a.stem)).size).toBe(list.length)
    for (let i = 1; i < list.length; i++) expect(list[i].cost).toBeGreaterThanOrEqual(list[i - 1].cost)
  })

  it('詞綴經過正規化（與搜尋鍵一致）', () => {
    const upper = createAnalyzer({ prefixes: [{ form: 'MU-' }] }, (s) => s.toLowerCase().replace(/-/g, ''))
    expect(upper.analyze('mudaux').map((a) => a.stem)).toEqual(['daux'])
  })
})

describe('generate：還原詞綴', () => {
  it('每個分析都能還原成原詞形（隨機詞形的性質測試）', () => {
    let seed = 42
    const rnd = (/** @type {number} */ n) => (seed = (seed * 16807) % 2147483647) % n
    const letters = 'abdiklmnpstuxz'
    const words = []
    for (let i = 0; i < 400; i++) {
      // 由隨機詞幹套上隨機詞綴產生詞形，讓分析器有東西可以剝
      let stem = ''
      for (let k = 0; k < 3 + rnd(4); k++) stem += letters[rnd(letters.length)]
      const steps = []
      const kinds = ['prefix', 'suffix', 'infix', 'reduplication']
      for (let k = 0; k < rnd(4); k++) {
        const type = kinds[rnd(kinds.length)]
        if (type === 'prefix') steps.push({ type, form: SPEC.prefixes[rnd(3)].form, gloss: null, cost: 0.3 })
        if (type === 'suffix') steps.push({ type, form: SPEC.suffixes[rnd(3)].form, gloss: null, cost: 0.3 })
        if (type === 'infix') steps.push({ type, form: SPEC.infixes[rnd(2)].form, gloss: null, cost: 0.3 })
        if (type === 'reduplication') steps.push({ type, form: '', pattern: 'Ca', gloss: null, cost: 0.3 })
      }
      words.push(analyzer.generate(stem, steps))
    }
    let analyses = 0
    for (const w of words) {
      for (const a of analyzer.analyze(w)) {
        analyses++
        expect(analyzer.generate(a.stem, a.steps), `${w} ← ${a.stem}`).toBe(w)
      }
    }
    expect(analyses).toBeGreaterThan(300)
  })

  it('由詞幹產生衍生詞', () => {
    const { steps } = /** @type {any} */ (analyzer.analyze('mubinaketan').find((a) => a.stem === 'baket'))
    expect(analyzer.generate('baket', steps)).toBe('mubinaketan')
    expect(analyzer.generate('bitut', [{ type: 'suffix', form: 'un', gloss: null, cost: 0.3 }, { type: 'alternation', form: 't>d', gloss: null, cost: 0.3 }])).toBe('bitudun')
  })
})

describe('規格檢查', () => {
  it('沒有 morphology 的設定檔照常通過', () => {
    expect(validateMorphology(undefined)).toEqual([])
  })

  it('格式錯誤會列出', () => {
    expect(validateMorphology({ prefixes: [{ form: '' }], reduplication: [{ pattern: 'XX' }] })).toHaveLength(2)
    expect(validateMorphology({ alternations: [{ underlying: 't' }] })).toHaveLength(1)
    expect(() => createAnalyzer(/** @type {any} */ ({ cost: -1 }))).toThrow(/cost/)
  })

  // 驗證器先於一切：每一條非法輸入都必須被拒絕，而且訊息要指出是哪個欄位（preparing-tests：
  // 「沒觸發過的錯誤路徑，就等於沒處理」）。合法的邊界值則必須通過。
  it.each(/** @type {Array<[string, any, RegExp]>} */ ([
    ['成本為 Infinity', { cost: Infinity }, /morphology\.cost/],
    ['成本為 NaN', { lemmaDistance: NaN }, /morphology\.lemmaDistance/],
    ['minStem 不是整數', { minStem: 2.5 }, /morphology\.minStem.*整數/],
    ['minStem 為 0', { minStem: 0 }, /morphology\.minStem/],
    ['maxSteps 不是整數', { maxSteps: 1.5 }, /morphology\.maxSteps.*整數/],
    ['maxSteps 過大', { maxSteps: 50 }, /morphology\.maxSteps/],
    ['未知的欄位（拼錯）', { suffix: [{ form: 'an' }] }, /morphology\.suffix.*未知/],
    ['詞綴含空白', { prefixes: [{ form: 'mu ' }] }, /morphology\.prefixes\[0\]\.form.*空白/],
    ['詞綴的未知欄位', { suffixes: [{ form: 'an', costs: 0.2 }] }, /morphology\.suffixes\[0\]\.costs.*未知/],
    ['重疊的成本為負', { reduplication: [{ pattern: 'Ca', cost: -0.1 }] }, /morphology\.reduplication\[0\]\.cost/],
    ['交替的成本為負', { alternations: [{ underlying: 't', surface: 'd', cost: -1 }] }, /morphology\.alternations\[0\]\.cost/],
    ['交替的 before 含空字串', { alternations: [{ underlying: 't', surface: 'd', before: [''] }] }, /morphology\.alternations\[0\]\.before/],
    ['交替含空白', { alternations: [{ underlying: 't ', surface: 'd' }] }, /morphology\.alternations\[0\].*空白/],
    ['元音含空白', { vowels: 'a e' }, /morphology\.vowels/],
  ]))('拒絕非法輸入：%s', (_name, spec, message) => {
    const errors = validateMorphology(spec)
    expect(errors.some((e) => message.test(e)), errors.join('；')).toBe(true)
  })

  it('合法的邊界值通過', () => {
    expect(validateMorphology({ cost: 0, minStem: 1, maxSteps: 0, lemmaDistance: 0, affixDistance: 0, lemmaSpread: 0 })).toEqual([])
    expect(
      validateMorphology({
        prefixes: [{ form: 'mu', gloss: { zh: '主事焦點' }, cost: 0.2, ref: 'Lim & Zeitoun 2024 §51.2.4', note: '異體見 me-、mi-、m-' }],
        alternations: [{ underlying: 'p', surface: 'b', before: ['i'], cost: 0.05, ref: '詞典 p.19' }],
        reduplication: [{ pattern: 'Ca', cost: 0.3, gloss: null }],
      }),
    ).toEqual([])
  })

  it('語言設定檔驗證包含構詞規格', () => {
    const errors = validateProfile({ format: 'babizu-language-profile', version: 1, morphology: { suffixes: 'an' } })
    expect(errors).toContain('morphology.suffixes 必須是陣列')
  })
})
