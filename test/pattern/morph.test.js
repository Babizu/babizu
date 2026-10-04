/**
 * 構詞樣式的比對（src/pattern/morph.js）：詞綴錨定在詞緣而且相連、外側的 … 不錨定、
 * 依模糊程度取拆法（先求最好的再扣音變）、一種拆法的詞素、構式的 parts、哪一段是詞根。
 */

import { describe, expect, it } from 'vitest'
import { PatternError } from '../../src/pattern/errors.js'
import { createPatternMorphology, PARSE_SELECTION, readingOfSteps, satisfies, selectParses, stepMorphs } from '../../src/pattern/morph.js'
import { parsePattern } from '../../src/pattern/parser.js'
import { createTextTools } from '../../src/search/text.js'
import { PAZEH_PROFILE } from '../fixtures/pazeh.js'
import { PATTERN_GRAMMAR } from './fixture.js'

/** @param {string} label @param {string[]} forms @returns {import('../../src/pattern/morph.js').AffixGroup} */
const group = (label, forms, type = /** @type {const} */ ('prefix')) => ({ type, forms: new Set(forms), label })
/** @param {Partial<import('../../src/pattern/morph.js').MorphRequirement>} r */
const req = (r) => ({ root: null, rootExact: false, prefixes: [], suffixes: [], prefixesAnywhere: false, suffixesAnywhere: false, infixes: [], red: false, ...r })
/** @param {string[]} left @param {string[]} [right] @param {string[]} [infixes] */
const reading = (left, right = [], infixes = []) => ({
  left: left.map((form) => ({ type: /** @type {const} */ ('prefix'), form })),
  right: right.map((form) => ({ type: /** @type {const} */ ('suffix'), form })),
  infixes: infixes.map((form) => ({ type: /** @type {const} */ ('infix'), form })),
  red: false,
})

describe('比對：詞綴從最外層算起、彼此相連，中綴不看位置', () => {
  it('pa-ka-… 找得到 pa-ka-x、pa-ka-ma-x（ma 在內側，由 … 吸收），找不到 ka-pa-x、pa-ma-ka-x、ma-pa-ka-x', () => {
    const r = req({ prefixes: [group('pa-', ['pa']), group('ka-', ['ka'])] })
    expect(satisfies(r, reading(['pa', 'ka']))).toBe(true)
    expect(satisfies(r, reading(['pa', 'ka', 'ma']))).toBe(true)
    expect(satisfies(r, reading(['ka', 'pa']))).toBe(false)
    expect(satisfies(r, reading(['pa', 'ma', 'ka']))).toBe(false)
    expect(satisfies(r, reading(['ma', 'pa', 'ka']))).toBe(false)
  })

  it('imini（i-m-ini）：m-… 不中（最外層是 i-），…-m-… 中', () => {
    const m = group('m-', ['m', 'mu', 'mi', 'me'])
    expect(satisfies(req({ prefixes: [m] }), reading(['i', 'm']))).toBe(false)
    expect(satisfies(req({ prefixes: [m], prefixesAnywhere: true }), reading(['i', 'm']))).toBe(true)
    // 不錨定時列出的詞綴仍要相連：…-pa-ka-… 找不到 pa-ma-ka-x
    const pk = req({ prefixes: [group('pa-', ['pa']), group('ka-', ['ka'])], prefixesAnywhere: true })
    expect(satisfies(pk, reading(['ma', 'pa', 'ka', 'mi']))).toBe(true)
    expect(satisfies(pk, reading(['pa', 'ma', 'ka']))).toBe(false)
  })

  it('…-an-ay（由內而外）找得到 x-an-ay、x-i-an-ay（i 在內側），找不到 x-ay-an、x-an-ay-i', () => {
    const r = req({ suffixes: [group('-an', ['an'], 'suffix'), group('-ay', ['ay'], 'suffix')] })
    expect(satisfies(r, reading([], ['an', 'ay']))).toBe(true)
    expect(satisfies(r, reading([], ['i', 'an', 'ay']))).toBe(true)
    expect(satisfies(r, reading([], ['ay', 'an']))).toBe(false)
    expect(satisfies(r, reading([], ['an', 'ay', 'i']))).toBe(false)
    // 外側寫了 …（…-an-ay-…）就不必是最外層
    expect(satisfies({ ...r, suffixesAnywhere: true }, reading([], ['an', 'ay', 'i']))).toBe(true)
  })

  it('沒有列出前綴時，任何前綴都可以（…-en 找得到 pa-x-en）', () => {
    expect(satisfies(req({ suffixes: [group('-en', ['en'], 'suffix')] }), reading(['pa'], ['en']))).toBe(true)
  })

  it('同一個中綴寫兩次要有兩個', () => {
    const r = req({ infixes: [group('<in>', ['in'], 'infix'), group('<in>', ['in'], 'infix')] })
    expect(satisfies(r, reading([], [], ['in']))).toBe(false)
    expect(satisfies(r, reading([], [], ['in', 'in']))).toBe(true)
  })
})

describe('詞素：構式的 parts 與多層衍生', () => {
  it('構式的 parts 依推導順序（前綴由內而外）：p<in>a ＝ pa ＋ <in>', () => {
    const step = { type: 'prefix', form: 'pina', gloss: {}, cost: 0.1, parts: [{ id: 'CAUS', type: 'prefix', form: 'pa', gloss: {} }, { id: 'PRF', type: 'infix', form: 'in', gloss: {} }] }
    expect(stepMorphs(/** @type {any} */ (step))).toMatchObject({ left: [{ form: 'pa' }], infixes: [{ form: 'in' }], right: [] })
  })

  it('一種拆法的幾個步驟（由外而內）：ma-pa-x-an-ay；前綴由外而內，後綴由內而外', () => {
    const steps = [{ type: 'prefix', form: 'ma' }, { type: 'suffix', form: 'ay' }, { type: 'prefix', form: 'pa' }, { type: 'suffix', form: 'an' }]
    expect(readingOfSteps(/** @type {any} */ (steps))).toMatchObject({ left: [{ form: 'ma' }, { form: 'pa' }], right: [{ form: 'an' }, { form: 'ay' }] })
  })

  it('環綴與中綴：p<a>u-…-ay 的 pu 在外、<a> 是中綴、-ay 是後綴', () => {
    const steps = [{ type: 'circumfix', form: '', left: { type: 'infix', form: 'a' }, outer: 'pu', suffix: 'ay' }]
    expect(readingOfSteps(/** @type {any} */ (steps))).toMatchObject({ left: [{ form: 'pu' }], infixes: [{ form: 'a' }], right: [{ form: 'ay' }] })
  })
})

describe('依模糊程度取拆法（PARSE_SELECTION）', () => {
  /** @param {number} cost @param {number} sound @param {string} root */
  const p = (cost, sound, root) => ({ cost, sound, root })

  it('精確：最好的拆法（同分都取）；標準：差 0.1 以內；兩者音變 ≤ 0.2；寬鬆：全部、音變 ≤ 0.4', () => {
    const all = [p(0.1, 0, 'a'), p(0.1, 0.05, 'b'), p(0.2, 0, 'c'), p(0.3, 0, 'd'), p(0.5, 0.3, 'e'), p(0.6, 0.5, 'f')]
    expect(selectParses(all, 'exact').map((x) => x.root)).toEqual(['a', 'b'])
    expect(selectParses(all, 'normal').map((x) => x.root)).toEqual(['a', 'b', 'c'])
    expect(selectParses(all, 'loose').map((x) => x.root)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(selectParses([], 'loose')).toEqual([])
    expect(PARSE_SELECTION.normal).toEqual({ spread: 0.1, sound: 0.2 })
    expect(PARSE_SELECTION.exact).toEqual({ spread: 0, sound: 0.2 })
  })

  it('先求最好的再扣音變：最好的拆法音變太多時，精確模式不改取比它差的拆法', () => {
    const all = [p(0.4, 0.3, 'sound'), p(0.5, 0, 'plain')]
    expect(selectParses(all, 'exact')).toEqual([])
    expect(selectParses(all, 'normal').map((x) => x.root)).toEqual(['plain'])
    // 少量音變（交界濁化 0.05）的最好拆法，精確模式照收
    expect(selectParses([p(0.25, 0.05, 'hazap'), p(0.35, 0, 'other')], 'exact').map((x) => x.root)).toEqual(['hazap'])
  })

  it('從 BCDP 最好的命中算起：最好的命中不是拆法時（abak 最好的是 a- ＋ barak 0.25），差太多的拆法（a-pa-rak 0.55）標準不收', () => {
    const all = [p(0.55, 0, 'rak')]
    expect(selectParses(all, 'normal', 0.25)).toEqual([])
    expect(selectParses(all, 'exact', 0.25)).toEqual([])
    expect(selectParses(all, 'loose', 0.25).map((x) => x.root)).toEqual(['rak'])
    // 沒有給起點時從最好的拆法算起
    expect(selectParses(all, 'exact').map((x) => x.root)).toEqual(['rak'])
  })

  it('虛擬詞根的拆法另外取、不把詞庫拆法擠掉：pinahazaban 的 pa-<in>hazap-an（0.25）不因 pinahazab-an（虛擬，0.1）而落選', () => {
    /** @param {number} cost @param {number} sound @param {string} root @param {boolean} virtual */
    const q = (cost, sound, root, virtual) => ({ cost, sound, root, virtual })
    const all = [q(0.1, 0, 'pinahazab', true), q(0.1, 0, 'nahazaban', true), q(0.25, 0.05, 'hazap', false), q(0.45, 0.35, 'azapan', false)]
    expect(selectParses(all, 'normal', 0.25).map((x) => x.root)).toEqual(['pinahazab', 'nahazaban', 'hazap'])
    // 精確：詞庫的最好拆法（交界濁化 0.05）與虛擬詞根都收
    expect(selectParses(all, 'exact', 0.25).map((x) => x.root)).toEqual(['pinahazab', 'nahazaban', 'hazap'])
    expect(selectParses(all, 'loose', 0.25).map((x) => x.root)).toEqual(['pinahazab', 'nahazaban', 'hazap', 'azapan'])
    // 沒有給起點時從最好的詞庫拆法算起（不是虛擬詞根）
    expect(selectParses(all, 'normal').map((x) => x.root)).toContain('hazap')
    // 不論有沒有虛擬詞根，取到的詞庫拆法都一樣
    for (const f of ['exact', 'normal', 'loose']) {
      expect(selectParses(all, f, 0.25).filter((x) => !x.virtual), f).toEqual(selectParses(all.filter((x) => !x.virtual), f, 0.25))
    }
  })

  it('虛擬詞根的拆法不看與詞庫拆法差多少：最好的命中不是拆法時（abak 型，0.25），0.5 的虛擬詞根拆法照收（自動派生圖的邊）', () => {
    /** @param {number} cost @param {string} root @param {boolean} virtual */
    const q = (cost, root, virtual) => ({ cost, sound: 0, root, virtual })
    const all = [q(0.5, 'v', true), q(0.55, 'rak', false)]
    expect(selectParses(all, 'exact', 0.25).map((x) => x.root)).toEqual(['v'])
    expect(selectParses(all, 'normal', 0.25).map((x) => x.root)).toEqual(['v'])
  })

  it('音變的上限：標準不收音變 0.3 的拆法，寬鬆收', () => {
    const all = [p(0.4, 0.3, 'x')]
    expect(selectParses(all, 'normal')).toEqual([])
    expect(selectParses(all, 'loose').map((x) => x.root)).toEqual(['x'])
  })
})

describe('哪一段是詞根', () => {
  const text = createTextTools({ ...PAZEH_PROFILE, morphology: PATTERN_GRAMMAR })
  const metric = text.createSearchMetric()
  const spec = /** @type {NonNullable<typeof text.morphology>} */ (text.morphology).spec
  /** @param {string} q @param {(key: string) => boolean} [isRoot] */
  const resolve = (q, isRoot) => {
    const morph = createPatternMorphology(spec, text.searchKey, (a, b) => metric.distance(a, b), isRoot)
    const atom = /** @type {any} */ (parsePattern(q).conditions[0].body).atom
    return morph.resolve(atom.segments, [])
  }

  it('只有一段當得成詞根：pa-kita 的 kita', () => {
    expect(resolve('pa-kita')).toMatchObject({ root: 'kita', prefixes: [{ label: 'pa-' }] })
  })

  it('兩段都當得成時，留下 BCDP 可能當成詞根的那一段：至少 minStem 個字元、而且是詞根', () => {
    // tau 是前綴也可以是詞根，ena 是後綴也可以是詞根（平面清單的規格）
    const flat = createTextTools({ ...PAZEH_PROFILE, morphology: { cost: 0.1, minStem: 3, prefixes: [{ form: 'tau' }, { form: 'ka' }], suffixes: [{ form: 'ena' }, { form: 'en' }] } })
    /** @param {string} q @param {(key: string) => boolean} isRoot */
    const pick = (q, isRoot) => {
      const morph = createPatternMorphology(/** @type {any} */ (flat.morphology).spec, flat.searchKey, (a, b) => flat.createSearchMetric().distance(a, b), isRoot)
      return morph.resolve(/** @type {any} */ (parsePattern(q).conditions[0].body).atom.segments, [])
    }
    expect(pick('tau-ena', (k) => k === 'tau')).toMatchObject({ root: 'tau', suffixes: [{ label: '-ena' }], prefixes: [] })
    expect(pick('tau-ena', (k) => k === 'ena')).toMatchObject({ root: 'ena', prefixes: [{ label: 'tau-' }], suffixes: [] })
    // 兩個都是詞根、都不是詞根：看不出來，報錯（請用 … 或引號以外的方式寫清楚）
    expect(() => pick('tau-ena', () => true)).toThrow(PatternError)
    expect(() => pick('tau-ena', () => false)).toThrow(PatternError)
    // ka、en 都比 minStem 短，不可能是詞根
    expect(() => pick('ka-en', () => true)).toThrow(PatternError)
  })

  it('外側的 …：那一側不錨定；哪一個 … 是詞根由中間的詞綴是前綴還是後綴決定', () => {
    expect(resolve('…-pa-…')).toMatchObject({ root: null, prefixes: [{ label: 'pa-' }], prefixesAnywhere: true, suffixesAnywhere: false })
    expect(resolve('…-en-…')).toMatchObject({ root: null, suffixes: [{ label: '-en' }], prefixesAnywhere: false, suffixesAnywhere: true })
    expect(resolve('…-ta-…-i-…')).toMatchObject({ prefixes: [{ label: 'ta-' }], suffixes: [{ label: '-i' }], prefixesAnywhere: true, suffixesAnywhere: true })
    expect(resolve('…-ka-…-en')).toMatchObject({ prefixesAnywhere: true, suffixesAnywhere: false })
    expect(resolve('…-pa-kita')).toMatchObject({ root: 'kita', prefixes: [{ label: 'pa-' }], prefixesAnywhere: true })
    expect(resolve('-pa-')).toMatchObject({ root: null, prefixesAnywhere: true })
    // 沒有外側的 … 時錨定
    expect(resolve('pa-…')).toMatchObject({ prefixesAnywhere: false, suffixesAnywhere: false })
    // 外側的 … 與詞根之間要有詞綴；不認得的詞綴照樣報錯（以前綴解析，列出最接近的）
    expect(() => resolve('…-<in>-…')).toThrow(expect.objectContaining({ code: 'E_MULTI_ROOT' }))
    expect(() => resolve('…-xyz-…')).toThrow(expect.objectContaining({ code: 'E_UNKNOWN_AFFIX', params: expect.objectContaining({ side: 'prefix' }) }))
  })

  it('…-i-…：i 是前綴也是後綴，看不出哪一個 … 是詞根，報錯並給出兩種只看最外層的寫法', () => {
    const flat = createTextTools({ ...PAZEH_PROFILE, morphology: { cost: 0.1, minStem: 3, prefixes: [{ form: 'i' }, { form: 'pa' }], suffixes: [{ form: 'i' }, { form: 'en' }] } })
    const morph = createPatternMorphology(/** @type {any} */ (flat.morphology).spec, flat.searchKey, (a, b) => flat.createSearchMetric().distance(a, b))
    /** @param {string} q */
    const pick = (q) => morph.resolve(/** @type {any} */ (parsePattern(q).conditions[0].body).atom.segments, [])
    expect(() => pick('…-i-…')).toThrow(expect.objectContaining({ code: 'E_AMBIGUOUS_SIDE', params: { forms: 'i', prefix: 'i-…', suffix: '…-i' } }))
    // 只有一種讀法時沒有歧義
    expect(pick('…-pa-…')).toMatchObject({ prefixesAnywhere: true })
    expect(pick('i-…')).toMatchObject({ prefixes: [{ label: 'i-' }] })
    expect(pick('…-i')).toMatchObject({ suffixes: [{ label: '-i' }] })
  })

  it('… 優先當詞根：tau-i-…（tau 是前綴也是詞庫中的詞，i 是前綴也是後綴）是前綴 tau-、i-，不是詞根 tau 加後綴 -i 與外側的 …', () => {
    const flat = createTextTools({ ...PAZEH_PROFILE, morphology: { cost: 0.1, minStem: 3, prefixes: [{ form: 'tau' }, { form: 'i' }], suffixes: [{ form: 'i' }, { form: 'en' }] } })
    const morph = createPatternMorphology(/** @type {any} */ (flat.morphology).spec, flat.searchKey, (a, b) => flat.createSearchMetric().distance(a, b), (k) => k === 'tau')
    /** @param {string} q */
    const pick = (q) => morph.resolve(/** @type {any} */ (parsePattern(q).conditions[0].body).atom.segments, [])
    expect(pick('tau-i-…')).toMatchObject({ root: null, prefixes: [{ label: 'tau-' }, { label: 'i-' }], suffixes: [], prefixesAnywhere: false })
    // … 當不成詞根時（en 不是前綴）才是外側的 …
    expect(pick('tau-en-…')).toMatchObject({ root: 'tau', suffixes: [{ label: '-en' }], suffixesAnywhere: true })
  })
})
