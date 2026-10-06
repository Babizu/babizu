/**
 * 構詞規格：去詞綴（同一個 BCDP 的字面開放詞幹，open-stems.js）、重疊模板與還原詞綴（generate）、規格檢查。
 * 規格是合成的，只用來驗證機制；真實語言的詞綴清單屬於各站台的語言設定檔。
 * 去詞綴的成本與窮舉參考實作逐一相同（bcdp-reference.test.js 的「開放詞幹」）；這裡是語意的固定案例。
 */

import { describe, expect, it } from 'vitest'
import { createAnalyzer, REDUPLICATION_PATTERNS, validateMorphology, validateProfile } from '../../src/fuzzy/index.js'
import { rootCostOf } from '../../src/fuzzy/morphology.js'
import { openAnalyzer } from './open-stems.js'

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
const open = openAnalyzer(SPEC)
const analyzer = open.analyzer
const stems = (/** @type {string} */ w) => open.analyze(w).map((a) => a.stem)
/** @param {string} w @param {string} stem */
const find = (w, stem) => open.analyze(w, 2).find((x) => x.stem === stem)

describe('去詞綴：字面的開放詞幹', () => {
  it('前綴、後綴、前後綴', () => {
    expect(stems('mudaux')).toContain('daux')
    expect(stems('tukuan')).toContain('tuku')
    expect(stems('mupatukuan')).toEqual(expect.arrayContaining(['patukuan', 'tukuan', 'tuku']))
  })

  it('中綴：首輔音之後、首元音之前', () => {
    const a = find('binaket', 'baket')
    expect(a?.steps).toEqual([expect.objectContaining({ type: 'infix', form: 'in' })])
    // 拿掉中綴後首輔音後面接的不是元音 → 不是中綴（還原時位置會不一致）
    expect(stems('tinsak')).not.toContain('tsak')
  })

  it('Ca 重疊：詞幹首輔音＋a；元音開頭的詞幹只重疊 a', () => {
    expect(find('sasuzuk', 'suzuk')?.steps[0]).toMatchObject({
      type: 'reduplication',
      form: 'sa',
      pattern: 'Ca',
    })
    expect(stems('aalep')).toContain('alep')
  })

  it('構詞音變（詞幹末的 t → d）在後綴前還原：它是交界上的規則，成本在對齊裡，不是步驟', () => {
    const a = find('bitudun', 'bitut')
    expect(a?.steps.map((s) => s.type)).toEqual(['suffix'])
    expect(a?.cost).toBeCloseTo(0.6)
    // 原樣的詞幹（bitud）也在，便宜一個構詞音變
    expect(find('bitudun', 'bitud')?.cost).toBeCloseTo(0.3)
    expect(stems('bituden')).toContain('bitut') // 任何後綴前都可以（before 已移除）
    expect(stems('bitud')).not.toContain('bitut') // 沒有後綴：不是詞素交界
  })

  it('詞幹最短長度（詞庫詞至少 minStem 個字元）與步數預算（與 BCDP 相同，docs/bcdp.md 1.6 第 6 項）', () => {
    expect(stems('muan')).toEqual([]) // 剝掉後只剩 2 個字元
    const deep = open.analyze('mupakabinaketan', 2)
    const count = (/** @type {any} */ a, /** @type {string[]} */ types) => a.steps.filter((/** @type {any} */ s) => types.includes(s.type)).length
    for (const a of deep) {
      expect(count(a, ['prefix'])).toBeLessThanOrEqual(3) // 前綴至多 maxSteps 個
      expect(count(a, ['suffix'])).toBeLessThanOrEqual(3) // 後綴至多 maxSteps 個（構詞音變不另外佔步數）
      expect(count(a, ['infix', 'reduplication', 'circumfix'])).toBeLessThanOrEqual(1) // 包覆單位至多一個
    }
    // 三個前綴＋中綴＋後綴，共五步：前後綴各自計數，所以找得到（步驟由外而內：前綴、包覆單位、後綴）
    expect(deep.find((a) => a.stem === 'baket')?.steps.map((s) => s.type)).toEqual(['prefix', 'prefix', 'prefix', 'infix', 'suffix'])
  })

  it('步驟的結構：前綴在外、包覆單位（中綴、重疊、環綴）緊貼詞幹、後綴在外；構詞音變可以與包覆單位同時發生', () => {
    // bitudunan ＝ bitut ＋ -un ＋ -an，t → d 在 bitut 與 -un 的交界
    const a = /** @type {any} */ (find('bitudunan', 'bitut'))
    expect(a.steps.map((/** @type {any} */ s) => s.type)).toEqual(['suffix', 'suffix'])
    expect(a.cost).toBeCloseTo(0.9)
    // b‹in›itut ＋ -an：中綴與詞幹末的構詞音變同時發生（構詞音變是交界上的規則，不佔包覆單位的名額）
    expect(find('binitudan', 'bitut')?.steps.map((s) => `${s.type}:${s.form}`)).toEqual(['infix:in', 'suffix:an'])
    for (const w of ['bitudunan', 'kinapatan', 'mupakakawasan', 'mubinaketan', 'papaketen', 'tatudan']) {
      for (const x of open.analyze(w, 2)) {
        const types = x.steps.map((s) => (s.type === 'prefix' || s.type === 'suffix' ? s.type : 'op')).join(' ')
        expect(types, `${w} → ${x.stem}`).toMatch(/^(prefix ?)*(op ?)?(suffix ?)*$/)
      }
    }
  })

  it('同一個詞幹只保留成本最低的分析，依成本排序', () => {
    const list = open.analyze('mupatukuan')
    expect(new Set(list.map((a) => a.stem)).size).toBe(list.length)
    for (let i = 1; i < list.length; i++) expect(list[i].cost).toBeGreaterThanOrEqual(list[i - 1].cost)
  })

  it('詞綴經過正規化（與搜尋鍵一致）', () => {
    const upper = openAnalyzer({ prefixes: [{ form: 'MU-' }] })
    expect(upper.analyzer.spec.prefixes.map((a) => a.form)).toEqual(['mu'])
    expect(upper.analyze('mudaux').map((a) => a.stem)).toEqual(['daux'])
  })
})

describe('環綴：一個步驟，緊貼詞幹', () => {
  const circ = openAnalyzer({
    ...SPEC,
    suffixes: [...SPEC.suffixes, { form: 'aw' }, { form: 'ay' }],
    circumfixes: [
      { prefix: 'ta', suffix: 'aw', gloss: 'HORT' },
      { infix: 'in', suffix: 'an' },
      { reduplication: 'Ca', suffix: 'ay', cost: 0.2 },
    ],
  })
  const findC = (/** @type {string} */ w, /** @type {string} */ stem) => circ.analyze(w).find((a) => a.stem === stem)

  it('前綴式：ta-…-aw 算一步（0.3），比前綴＋後綴（0.6）便宜', () => {
    const a = /** @type {any} */ (findC('takitaaw', 'kita'))
    expect(a.cost).toBeCloseTo(0.3, 9)
    expect(a.steps).toEqual([{ type: 'circumfix', form: 'ta…aw', left: { type: 'prefix', form: 'ta' }, suffix: 'aw', gloss: 'HORT', cost: 0.3 }])
    expect(circ.analyzer.generate('kita', a.steps)).toBe('takitaaw')
  })

  it('中綴式、重疊式；外面還可以再加前綴', () => {
    const a = /** @type {any} */ (findC('binaketan', 'baket'))
    expect(a.steps.map((/** @type {any} */ s) => s.form)).toEqual(['in…an'])
    const b = /** @type {any} */ (findC('mudadauxay', 'daux'))
    expect(b.steps.map((/** @type {any} */ s) => s.form)).toEqual(['mu', 'da…ay'])
    expect(b.cost).toBeCloseTo(0.5, 9)
    expect(circ.analyzer.generate('daux', b.steps)).toBe('mudadauxay')
  })

  it('環綴裡面不能再有詞綴：ta-pa-kita-aw 不是 ta-…-aw 包住 pa-kita', () => {
    expect(circ.analyze('tapakitaaw').some((a) => a.stem === 'kita' && a.steps.some((s) => s.type === 'circumfix'))).toBe(false)
  })
})

describe('重疊模板（docs/bcdp.md 1.6 第 2 項）', () => {
  // 例子取自 Lim & Zeitoun (2024) §51.3.2.2 的歸類，詞見公開資料集
  const red = createAnalyzer({ vowels: 'aeiou', glides: 'iu' }).reduplicant
  it.each(/** @type {Array<[any, string, string | null]>} */ ([
    ['Ca', 'dius', 'da'],
    ['Ca', 'luzuk', 'la'],
    ['Ca', 'alep', 'a'], // 元音開頭：首輔音是空的
    ['CV', 'kiliw', 'ki'],
    ['CVV', 'depex', 'dee'],
    ['CVV', 'kita', 'kii'],
    // CGV、CVG：含滑音的音節（i、u 當滑音）。CGV 第一個是滑音（ria /rja/），兩個都是滑音的也歸 CGV（ziu /zju/）；
    // CVG 第二個是滑音（bai /baj/）；元音核只有一個元音、兩個相同或沒有滑音時不適用
    ['CGV', 'riak', 'ria'],
    ['CGV', 'tianak', 'tia'],
    ['CGV', 'ziux', 'ziu'],
    ['CGV', 'luis', 'lui'],
    ['CGV', 'bair', null],
    ['CGV', 'kita', null],
    ['CVG', 'bair', 'bai'],
    ['CVG', 'taukua', 'tau'],
    ['CVG', 'heul', 'heu'],
    ['CVG', 'riak', null],
    ['CVG', 'ziux', null],
    ['CVG', 'baaket', null],
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
    const analyzer = createAnalyzer({ vowels: 'aiu', glides: 'iu' })
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

  it('去詞綴：模板只套用在詞幹上（不含後綴）', () => {
    const red = openAnalyzer({ vowels: 'aiu', minStem: 3, suffixes: [{ form: 'an' }, { form: 'i' }], reduplication: [{ pattern: 'CVCV' }] })
    // kipu~kiput-i：重疊部分由詞幹 kiput 產生
    expect(red.analyze('kipukiputi').find((a) => a.stem === 'kiput')?.steps.map((s) => s.type)).toEqual(['reduplication', 'suffix'])
    // kanakanan：kan 只有一個音節，不是 kan-an 的重疊（模板套用在 kanan 上才會得到 kana）
    expect(red.analyze('kanakanan').map((a) => a.stem)).not.toContain('kan')
    expect(red.analyze('kanakanan').map((a) => a.stem)).toContain('kanan')
  })
})

describe('generate：還原詞綴', () => {
  it('每個分析都能還原成原詞形（隨機詞形的性質測試，含所有重疊型式）：由推導重建底層字串，與詞形相同', () => {
    // 沒有構詞音變：底層字串就是詞形本身（有構詞音變時，兩者差在交界上的規則，成本在對齊裡）
    const every = openAnalyzer({
      ...SPEC,
      alternations: [],
      glides: 'iu',
      reduplication: REDUPLICATION_PATTERNS.map((pattern) => ({ pattern })),
      circumfixes: [{ prefix: 'ta', suffix: 'aw' }, { infix: 'in', suffix: 'an' }, { reduplication: 'CV', suffix: 'en' }],
    })
    let seed = 42
    const rnd = (/** @type {number} */ n) => (seed = (seed * 16807) % 2147483647) % n
    const letters = 'abdiklmnpstuxz'
    const words = []
    for (let i = 0; i < 400; i++) {
      // 由隨機詞幹套上隨機詞綴產生詞形，讓分析器有東西可以剝
      let stem = ''
      for (let k = 0; k < 3 + rnd(4); k++) stem += letters[rnd(letters.length)]
      const steps = []
      const kinds = ['prefix', 'suffix', 'infix', 'reduplication', 'circumfix']
      for (let k = 0; k < rnd(4); k++) {
        const type = kinds[rnd(kinds.length)]
        if (type === 'prefix') steps.push({ type, form: SPEC.prefixes[rnd(3)].form, gloss: null, cost: 0.3 })
        if (type === 'suffix') steps.push({ type, form: SPEC.suffixes[rnd(3)].form, gloss: null, cost: 0.3 })
        if (type === 'infix') steps.push({ type, form: SPEC.infixes[rnd(2)].form, gloss: null, cost: 0.3 })
        if (type === 'reduplication') steps.push({ type, form: '', pattern: REDUPLICATION_PATTERNS[rnd(REDUPLICATION_PATTERNS.length)], gloss: null, cost: 0.3 })
        if (type === 'circumfix') {
          const c = every.analyzer.spec.circumfixes[rnd(3)]
          steps.push({ type, form: '', left: { type: c.kind, form: c.left, pattern: c.left }, suffix: c.suffix, gloss: null, cost: 0.3 })
        }
      }
      words.push(every.analyzer.generate(stem, /** @type {any} */ (steps)))
    }
    let analyses = 0
    for (const w of words) {
      for (const a of every.analyze(w)) {
        analyses++
        expect(every.analyzer.generate(a.stem, a.steps), `${w} ← ${a.stem}`).toBe(w)
        // 成本就是步驟成本的和（沒有任何音變）
        expect(a.cost, `${w} ← ${a.stem}`).toBeCloseTo(a.steps.reduce((x, st) => x + st.cost, 0), 9)
      }
    }
    expect(analyses).toBeGreaterThan(300)
  })

  it('由詞幹產生衍生詞', () => {
    const { steps } = /** @type {any} */ (find('mubinaketan', 'baket'))
    expect(analyzer.generate('baket', steps)).toBe('mubinaketan')
    // 構詞音變不在步驟裡：還原出的是底層的詞形
    expect(analyzer.generate('bitut', [{ type: 'suffix', form: 'un', gloss: null, cost: 0.3 }])).toBe('bitutun')
  })
})

describe('規格檢查', () => {
  it('沒有 morphology 的設定檔照常通過', () => {
    expect(validateMorphology(undefined)).toEqual([])
  })

  it('rootSyllableCost：鍵是音節數、值是非負的成本；rootCostOf 依元音字母數，沒列的是 0，最大的鍵也套用到更多音節', () => {
    expect(validateMorphology({ rootSyllableCost: { 1: 0.1, 3: 0.1, 4: 0.2 } })).toEqual([])
    expect(validateMorphology({ rootSyllableCost: { 0: 0.1, x: 0.1, 2: -1 } })).toHaveLength(3)
    expect(validateMorphology({ rootSyllableCost: [0.1] })).toHaveLength(1)
    const cost = rootCostOf(createAnalyzer({ vowels: 'aiu', rootSyllableCost: { 1: 0.1, 3: 0.2, 4: 0.3 } }).spec)
    // ban 1、kita 2、ituku 3、aitukuan 5（4 以上）、ng 0 個音節
    expect(['ban', 'kita', 'ituku', 'aitukuan', 'ng'].map(cost)).toEqual([0.1, 0, 0.2, 0.3, 0])
    expect(rootCostOf(createAnalyzer({}).spec)('ban')).toBe(0)
  })

  it('rootSyllableCost 的值可以分兩種詞根：entry（辭典的詞條或標為詞根）與 other（其他、虛擬詞根）', () => {
    const table = { 1: 0.5, 2: { entry: 0, other: 0.2 }, 3: 0.1, 4: 0.2 }
    expect(validateMorphology({ rootSyllableCost: table })).toEqual([])
    expect(validateMorphology({ rootSyllableCost: { 2: { entry: 0 } } })).toHaveLength(1)
    expect(validateMorphology({ rootSyllableCost: { 2: { entry: 0, other: 0.2, x: 1 } } })).toHaveLength(1)
    const cost = rootCostOf(createAnalyzer({ vowels: 'aiu', rootSyllableCost: table }).spec)
    expect(['ban', 'kita', 'ituku', 'aitukuan'].map((r) => cost(r, true))).toEqual([0.5, 0, 0.1, 0.2])
    expect(['ban', 'kita', 'ituku', 'aitukuan'].map((r) => cost(r, false))).toEqual([0.5, 0.2, 0.1, 0.2])
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
    ['詞庫外詞根的成本為負', { virtualRootLengthCost: -0.03 }, /morphology\.virtualRootLengthCost/],
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
    ['環綴只有後綴', { circumfixes: [{ suffix: 'aw' }] }, /morphology\.circumfixes\[0\].*至少要有兩個部分/],
    ['環綴的中綴與重疊都有', { circumfixes: [{ infix: 'in', reduplication: 'Ca', suffix: 'aw' }] }, /morphology\.circumfixes\[0\].*至多一個/],
    ['stemInitial 用在中綴式的環綴', { circumfixes: [{ prefix: 'm', infix: 'a', stemInitial: 'V' }] }, /morphology\.circumfixes\[0\]\.stemInitial/],
    ['stemInitial 不是 V', { circumfixes: [{ prefix: 'ma', stemInitial: 'C' }] }, /morphology\.circumfixes\[0\]\.stemInitial/],
    ['環綴的重疊型式拼錯', { circumfixes: [{ reduplication: 'CA', suffix: 'ay' }] }, /morphology\.circumfixes\[0\]\.reduplication/],
    ['環綴只有前綴', { circumfixes: [{ prefix: 'ta' }] }, /morphology\.circumfixes\[0\].*至少要有兩個部分/],
    ['環綴含空白', { circumfixes: [{ prefix: 'ta ', suffix: 'aw' }] }, /morphology\.circumfixes\[0\]\.prefix.*空白/],
    ['環綴的未知欄位', { circumfixes: [{ prefix: 'ta', suffix: 'aw', form: 'x' }] }, /morphology\.circumfixes\[0\]\.form.*未知/],
  ]))('拒絕非法輸入：%s', (_name, spec, message) => {
    const errors = validateMorphology(spec)
    expect(errors.some((e) => message.test(e)), errors.join('；')).toBe(true)
  })

  it('環綴（包覆單位）的各種形狀：前綴＋中綴、前綴＋重疊、三個部分都有、只有前綴但要求詞幹元音開頭', () => {
    expect(
      validateMorphology({
        circumfixes: [
          { prefix: 'm', infix: 'a' },
          { prefix: 'sa', reduplication: 'CV' },
          { prefix: 'm', infix: 'a', suffix: 'ay' },
          { prefix: 'ma', stemInitial: 'V' },
          { prefix: 'ma', suffix: 'ay', stemInitial: 'V' },
        ],
      }),
    ).toEqual([])
  })

  it('合法的邊界值通過', () => {
    expect(validateMorphology({ cost: 0, minStem: 1, maxSteps: 0, lemmaSpread: 0, virtualRootLengthCost: 0 })).toEqual([])
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
