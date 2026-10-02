/**
 * 構詞樣式的比對（src/pattern/morph.js）：詞素的順序（子序列）、多層衍生的組合、構式的 parts。
 */

import { describe, expect, it } from 'vitest'
import { PatternError } from '../../src/pattern/errors.js'
import { createPatternMorphology, readingOfPath, satisfies, stepMorphs } from '../../src/pattern/morph.js'
import { parsePattern } from '../../src/pattern/parser.js'
import { createTextTools } from '../../src/search/text.js'
import { PAZEH_PROFILE } from '../fixtures/pazeh.js'
import { PATTERN_GRAMMAR } from './fixture.js'

/** @param {string} label @param {string[]} forms @returns {import('../../src/pattern/morph.js').AffixGroup} */
const group = (label, forms, type = /** @type {const} */ ('prefix')) => ({ type, forms: new Set(forms), label })
/** @param {Partial<import('../../src/pattern/morph.js').MorphRequirement>} r */
const req = (r) => ({ root: null, rootExact: false, prefixes: [], suffixes: [], infixes: [], red: false, ...r })
/** @param {string[]} left @param {string[]} [right] @param {string[]} [infixes] */
const reading = (left, right = [], infixes = []) => ({
  left: left.map((form) => ({ type: /** @type {const} */ ('prefix'), form })),
  right: right.map((form) => ({ type: /** @type {const} */ ('suffix'), form })),
  infixes: infixes.map((form) => ({ type: /** @type {const} */ ('infix'), form })),
  red: false,
})

describe('比對：前綴、後綴是子序列，中綴不看位置', () => {
  it('pa-ka-… 找得到 pa-ka-x、pa-ma-ka-x，找不到 ka-pa-x', () => {
    const r = req({ prefixes: [group('pa-', ['pa']), group('ka-', ['ka'])] })
    expect(satisfies(r, reading(['pa', 'ka']))).toBe(true)
    expect(satisfies(r, reading(['pa', 'ma', 'ka']))).toBe(true)
    expect(satisfies(r, reading(['ka', 'pa']))).toBe(false)
  })

  it('…-an-ay（由內而外）找得到 x-an-ay，找不到 x-ay-an', () => {
    const r = req({ suffixes: [group('-an', ['an'], 'suffix'), group('-ay', ['ay'], 'suffix')] })
    expect(satisfies(r, reading([], ['an', 'ay']))).toBe(true)
    expect(satisfies(r, reading([], ['ay', 'an']))).toBe(false)
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

  it('兩層：sungut →（pu-）pusungut →（<a>、-ay）pausunguday；前綴由外而內，後綴由內而外', () => {
    /** @param {any[]} steps */
    const edge = (steps) => ({ analysis: { steps } })
    const path = [
      edge([{ type: 'prefix', form: 'pu' }, { type: 'suffix', form: 'an' }]),
      edge([{ type: 'prefix', form: 'ma' }, { type: 'infix', form: 'a' }, { type: 'suffix', form: 'ay' }]),
    ]
    expect(readingOfPath(/** @type {any} */ (path))).toMatchObject({
      left: [{ form: 'ma' }, { form: 'pu' }],
      right: [{ form: 'an' }, { form: 'ay' }],
      infixes: [{ form: 'a' }],
    })
  })

  it('一層裡的幾個步驟（由外而內）：ma-pa-x-an-ay', () => {
    const path = [{ analysis: { steps: [{ type: 'prefix', form: 'ma' }, { type: 'suffix', form: 'ay' }, { type: 'prefix', form: 'pa' }, { type: 'suffix', form: 'an' }] } }]
    expect(readingOfPath(/** @type {any} */ (path))).toMatchObject({ left: [{ form: 'ma' }, { form: 'pa' }], right: [{ form: 'an' }, { form: 'ay' }] })
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
})
