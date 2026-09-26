/**
 * 構詞分析：去詞綴（analyze）與還原詞綴（generate）。
 * 規格是合成的，只用來驗證機制；真實語言的詞綴清單屬於各站台的語言設定檔。
 */

import { describe, expect, it } from 'vitest'
import { createAnalyzer, REDUPLICATION_PATTERNS, validateMorphology, validateProfile } from '../../src/fuzzy/index.js'

const SPEC = {
  cost: 0.3,
  minStem: 3,
  maxSteps: 3,
  prefixes: [{ form: 'mu', gloss: { 'zh-TW': '主事焦點', en: 'AF' } }, { form: 'pa' }, { form: 'ka' }],
  suffixes: [{ form: 'an' }, { form: 'en' }, { form: 'un' }],
  infixes: [{ form: 'in' }, { form: 'a' }],
  reduplication: [{ pattern: 'Ca' }],
  alternations: [{ underlying: 't', surface: 'd' }],
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

  it('構詞音變（詞幹末的 t → d）在後綴前還原', () => {
    const a = analyzer.analyze('bitudun').find((x) => x.stem === 'bitut')
    expect(a?.steps.map((s) => s.type)).toEqual(['suffix', 'alternation'])
    expect(a?.cost).toBeCloseTo(0.6)
    expect(stems('bituden')).toContain('bitut') // 任何後綴前都可以（before 已移除）
    expect(stems('bitud')).not.toContain('bitut') // 沒有後綴：不是詞素交界
  })

  it('詞幹最短長度（詞庫詞至少 minStem 個字元）與步數預算（與 BCDP 相同，docs/bcdp.md 1.6 第 4 項）', () => {
    expect(stems('muan')).toEqual([]) // 剝掉後只剩 2 個字元
    const deep = analyzer.analyze('mupakabinaketan')
    const count = (/** @type {any} */ a, /** @type {string[]} */ types) => a.steps.filter((/** @type {any} */ s) => types.includes(s.type)).length
    for (const a of deep) {
      expect(count(a, ['prefix'])).toBeLessThanOrEqual(3) // 前綴至多 maxSteps 個
      expect(count(a, ['suffix'])).toBeLessThanOrEqual(3) // 後綴至多 maxSteps 個（構詞音變不另外佔步數）
      expect(count(a, ['infix', 'reduplication', 'alternation'])).toBeLessThanOrEqual(1) // 非串接步驟至多一個
    }
    // 三個前綴＋中綴＋後綴，共五步：前後綴各自計數，所以找得到
    expect(deep.find((a) => a.stem === 'baket')?.steps.map((s) => s.type)).toEqual(['prefix', 'prefix', 'prefix', 'suffix', 'infix'])
  })

  it('非串接步驟之後，同一端不能再剝詞綴（步驟由外而內）', () => {
    // 交替緊接最內層的後綴：bitudunan ＝ bitut ＋ -un（交替 t>d）＋ -an
    expect(analyzer.analyze('bitudunan').find((x) => x.stem === 'bitut')?.steps.map((s) => s.type)).toEqual(['suffix', 'suffix', 'alternation'])
    // 不變量：交替之後不再有後綴；中綴、重疊之後不再有前綴
    for (const w of ['bitudunan', 'kinapatan', 'mupakakawasan', 'mubinaketan', 'papaketen', 'tatudan']) {
      for (const a of analyzer.analyze(w)) {
        const types = a.steps.map((s) => s.type)
        const alt = types.indexOf('alternation')
        if (alt >= 0) expect(types.slice(alt + 1), `${w} → ${a.stem}`).not.toContain('suffix')
        const op = types.findIndex((t) => t === 'infix' || t === 'reduplication')
        if (op >= 0) expect(types.slice(op + 1), `${w} → ${a.stem}`).not.toContain('prefix')
        // 重疊的模板只套用在詞幹上：重疊是最內層的步驟
        const red = types.indexOf('reduplication')
        if (red >= 0) expect(red, `${w} → ${a.stem}`).toBe(types.length - 1)
      }
    }
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

describe('重疊模板（docs/bcdp.md 1.6 第 2 項）', () => {
  // 例子取自 Lim & Zeitoun (2024) §51.3.2.2 的歸類，詞見公開資料集
  const red = createAnalyzer({ vowels: 'aeiou' }).reduplicant
  it.each(/** @type {Array<[any, string, string | null]>} */ ([
    ['Ca', 'dius', 'da'],
    ['Ca', 'luzuk', 'la'],
    ['Ca', 'alep', 'a'], // 元音開頭：首輔音是空的
    ['CV', 'kiliw', 'ki'],
    ['CVV', 'depex', 'dee'],
    ['CVV', 'kita', 'kii'],
    ['CVCV', 'kiput', 'kipu'],
    ['CVCV', 'lubahing', 'luba'],
    ['CVCV', 'kudung', 'kudu'],
    ['CVCVC', 'kudung', 'kudung'],
    ['CVCVC', 'lubahing', 'lubah'],
    ['full', 'kita', 'kita'],
    // 元音核是連續的元音：dius 的第一個元音核是 iu
    ['CVCV', 'diusan', 'diusa'],
    // 不在 vowels 中的字元（滑音、喉塞音）都當作輔音
    ['CV', "'aula", "'a"],
    ['CVCV', 'yawa', 'yawa'],
    // 不適用：沒有元音，或只有一個音節
    ['CV', 'ngb', null],
    ['CVCV', 'kan', null],
    ['CVCVC', 'bdk', null],
  ]))('%s(%s) ＝ %s', (pattern, base, want) => {
    expect(red(pattern, base)).toBe(want)
  })

  it('穩定引理：L ≥ |w| 時，模板套用在 base 開頭 L 個字元上的結果仍是 w；reduplicantStems 等於逐一檢查', () => {
    const analyzer = createAnalyzer({ vowels: 'aiu' })
    let seed = 7
    const rnd = (/** @type {number} */ n) => (seed = (seed * 16807) % 2147483647) % n
    const letters = 'aiubdkn y'
    let checked = 0
    for (let t = 0; t < 3000; t++) {
      const base = Array.from({ length: 1 + rnd(9) }, () => letters[rnd(letters.length)])
      for (const pattern of REDUPLICATION_PATTERNS) {
        const w = analyzer.reduplicant(pattern, base.join(''))
        if (w !== null && pattern !== 'full') {
          for (let l = Array.from(w).length; l <= base.length; l++) {
            expect(analyzer.reduplicant(pattern, base.slice(0, l).join('')), `${pattern} ${base.join('')} L=${l}`).toBe(w)
            checked++
          }
        }
        // reduplicantStems 對「每個可能的重疊部分」都要等於逐一檢查
        const candidates = new Set([w, ...base.map((_, l) => analyzer.reduplicant(pattern, base.slice(0, l + 1).join('')))])
        for (const r of candidates) {
          if (r === null) continue
          const brute = base.map((_, l) => l + 1).filter((l) => analyzer.reduplicant(pattern, base.slice(0, l).join('')) === r)
          expect(analyzer.reduplicantStems(pattern, base, r), `${pattern} ${base.join('')} ${r}`).toEqual(brute)
        }
      }
    }
    expect(checked).toBeGreaterThan(5000)
  })

  it('analyze：模板只套用在詞幹上（不含後綴）', () => {
    const analyzer = createAnalyzer({ vowels: 'aiu', minStem: 3, suffixes: [{ form: 'an' }, { form: 'i' }], reduplication: [{ pattern: 'CVCV' }] })
    // kipu~kiput-i：重疊部分由詞幹 kiput 產生
    expect(analyzer.analyze('kipukiputi').find((a) => a.stem === 'kiput')?.steps.map((s) => s.type)).toEqual(['suffix', 'reduplication'])
    // kanakanan：kan 只有一個音節，不是 kan-an 的重疊（模板套用在 kanan 上才會得到 kana）
    expect(analyzer.analyze('kanakanan').map((a) => a.stem)).not.toContain('kan')
    expect(analyzer.analyze('kanakanan').map((a) => a.stem)).toContain('kanan')
  })
})

describe('mayDerive：衍生的必要條件', () => {
  it('每個 analyze 找到的（詞, 詞幹）都滿足 mayDerive（隨機規格與詞形；含所有重疊型式、交替、無元音詞幹、非 BMP 字元）', () => {
    let seed = 2024
    const rnd = (/** @type {number} */ n) => (seed = (seed * 16807) % 2147483647) % n
    const letters = ['a', 'i', 'u', 'b', 'd', 'k', 'n', 't', '𝔞']
    const word = (/** @type {number} */ min, /** @type {number} */ max) => Array.from({ length: min + rnd(max - min + 1) }, () => letters[rnd(letters.length)]).join('')
    let checked = 0
    let rejected = 0
    /** reaching check：每種步驟都要真的出現過 @type {Set<string>} */
    const reached = new Set()
    for (let round = 0; round < 80; round++) {
      const analyzer = createAnalyzer({
        vowels: 'aiu𝔞',
        minStem: 2,
        maxSteps: 1 + rnd(2),
        prefixes: Array.from({ length: 1 + rnd(4) }, () => ({ form: word(1, 2) })),
        suffixes: Array.from({ length: 1 + rnd(4) }, () => ({ form: word(1, 2) })),
        infixes: rnd(2) ? [{ form: word(1, 2) }] : [],
        reduplication: rnd(3) ? [{ pattern: REDUPLICATION_PATTERNS[rnd(REDUPLICATION_PATTERNS.length)] }] : [],
        alternations: rnd(2) ? [{ underlying: 't', surface: 'd' }] : [],
      })
      const { spec } = analyzer
      for (let k = 0; k < 150; k++) {
        // 一半是隨機字串，一半由隨機詞幹套上隨機步驟產生（讓兩音節重疊等結構真的出現）
        let w = word(2, 9)
        if (k % 2) {
          /** @type {any[]} */
          const steps = []
          if (spec.reduplication.length && rnd(2)) steps.push({ type: 'reduplication', form: '', pattern: spec.reduplication[0].pattern })
          else if (spec.infixes.length && rnd(3) === 0) steps.push({ type: 'infix', form: spec.infixes[0].form })
          if (rnd(2)) steps.unshift({ type: 'suffix', form: spec.suffixes[rnd(spec.suffixes.length)].form })
          if (rnd(2)) steps.unshift({ type: 'prefix', form: spec.prefixes[rnd(spec.prefixes.length)].form })
          w = analyzer.generate(word(2, 6), steps)
        }
        for (const a of analyzer.analyze(w)) {
          checked++
          for (const s of a.steps) reached.add(s.pattern ?? s.type)
          expect(analyzer.mayDerive(w, a.stem), `${w} → ${a.stem}：${JSON.stringify(a.steps.map((s) => [s.type, s.form]))}`).toBe(true)
        }
        // 反方向：隨機的詞幹多半不成立（確認這個條件真的有篩選作用）
        if (!analyzer.mayDerive(w, word(2, 4))) rejected++
      }
    }
    expect(checked).toBeGreaterThan(2000)
    expect(rejected).toBeGreaterThan(1000)
    expect([...reached].sort()).toEqual(['prefix', 'suffix', 'infix', 'alternation', ...REDUPLICATION_PATTERNS].sort())
  })
})

describe('generate：還原詞綴', () => {
  it('每個分析都能還原成原詞形（隨機詞形的性質測試，含所有重疊型式）', () => {
    const everyPattern = createAnalyzer({ ...SPEC, reduplication: REDUPLICATION_PATTERNS.map((pattern) => ({ pattern })) })
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
        if (type === 'reduplication') steps.push({ type, form: '', pattern: REDUPLICATION_PATTERNS[rnd(REDUPLICATION_PATTERNS.length)], gloss: null, cost: 0.3 })
      }
      words.push(everyPattern.generate(stem, steps))
    }
    let analyses = 0
    for (const w of words) {
      for (const a of everyPattern.analyze(w)) {
        analyses++
        expect(everyPattern.generate(a.stem, a.steps), `${w} ← ${a.stem}`).toBe(w)
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
    ['成本為 NaN', { lemmaSpread: NaN }, /morphology\.lemmaSpread/],
    ['已移除的 lemmaDistance', { lemmaDistance: 0.3 }, /morphology\.lemmaDistance 已移除/],
    ['已移除的 affixDistance', { affixDistance: 0.2 }, /morphology\.affixDistance 已移除/],
    ['構詞音變的位置拼錯', { alternations: [{ underlying: 't', surface: 'd', position: 'end' }] }, /morphology\.alternations\[0\]\.position/],
    ['構詞音變兩側都空', { alternations: [{ underlying: '', surface: '' }] }, /morphology\.alternations\[0\]/],
    ['minStem 不是整數', { minStem: 2.5 }, /morphology\.minStem.*整數/],
    ['minStem 為 0', { minStem: 0 }, /morphology\.minStem/],
    ['maxSteps 不是整數', { maxSteps: 1.5 }, /morphology\.maxSteps.*整數/],
    ['maxSteps 過大', { maxSteps: 50 }, /morphology\.maxSteps/],
    ['未知的欄位（拼錯）', { suffix: [{ form: 'an' }] }, /morphology\.suffix.*未知/],
    ['詞綴含空白', { prefixes: [{ form: 'mu ' }] }, /morphology\.prefixes\[0\]\.form.*空白/],
    ['詞綴的未知欄位', { suffixes: [{ form: 'an', costs: 0.2 }] }, /morphology\.suffixes\[0\]\.costs.*未知/],
    ['重疊的成本為負', { reduplication: [{ pattern: 'Ca', cost: -0.1 }] }, /morphology\.reduplication\[0\]\.cost/],
    ['交替的成本為負', { alternations: [{ underlying: 't', surface: 'd', cost: -1 }] }, /morphology\.alternations\[0\]\.cost/],
    ['已移除的 before', { alternations: [{ underlying: 't', surface: 'd', before: ['an'] }] }, /morphology\.alternations\[0\]\.before 已移除/],
    ['交替含空白', { alternations: [{ underlying: 't ', surface: 'd' }] }, /morphology\.alternations\[0\].*空白/],
    ['元音含空白', { vowels: 'a e' }, /morphology\.vowels/],
  ]))('拒絕非法輸入：%s', (_name, spec, message) => {
    const errors = validateMorphology(spec)
    expect(errors.some((e) => message.test(e)), errors.join('；')).toBe(true)
  })

  it('合法的邊界值通過', () => {
    expect(validateMorphology({ cost: 0, minStem: 1, maxSteps: 0, lemmaSpread: 0 })).toEqual([])
    expect(
      validateMorphology({
        prefixes: [{ form: 'mu', gloss: { zh: '主事焦點' }, cost: 0.2, ref: 'Lim & Zeitoun 2024 §51.2.4', note: '異體見 me-、mi-、m-' }],
        alternations: [
          { underlying: 'p', surface: 'b', position: 'final', cost: 0.05, ref: '詞典 p.19' },
          { underlying: '', surface: "'", position: 'any' },
        ],
        reduplication: [{ pattern: 'Ca', cost: 0.3, gloss: null }],
      }),
    ).toEqual([])
  })

  it('語言設定檔驗證包含構詞規格', () => {
    const errors = validateProfile({ format: 'babizu-language-profile', version: 1, morphology: { suffixes: 'an' } })
    expect(errors).toContain('morphology.suffixes 必須是陣列')
  })
})
