/**
 * 性質測試用的合成語料（test/search/symmetry.test.js）：仿巴宰語的構詞文法、隨機詞根，加上依規則與不依規則的詞綴組合。
 * 詞根、詞與句子都是隨機產生的（不是取自任何來源）；構詞文法是巴宰語語法書中常見的詞綴（公開的語法知識）。
 *
 * 衍生詞由這裡自己的產生器接上詞綴（不是框架的 generate），所以可以拿來檢查框架的分析：
 * 前綴、後綴、中綴（插在詞幹首輔音之後）、重疊（CV、Ca）、組合規則，以及交界上的構詞音變
 * （詞尾 p t k 濁化、元音結尾的詞素接詞綴時插入喉塞音）。不依規則的組合（後綴疊加、超過步數上限的前綴、
 * 中綴加重疊）不要求找得到詞根，只用來檢查對稱性與一致性。
 */

import { createCitation, createRecord, createSense } from '../../src/schema/index.js'
import { buildDerivationGraph, buildParseChart, buildSearchIndex, SearchEngine } from '../../src/search/index.js'
import { PAZEH_PROFILE } from '../fixtures/pazeh.js'

/** 構詞文法：常見的前綴、後綴、中綴、重疊與組合規則，加上交界的構詞音變 */
export const PAZEH_LIKE_GRAMMAR = {
  cost: 0.1,
  minStem: 3,
  maxSteps: 3,
  glides: 'iu',
  morphemes: [
    { id: 'AF', type: 'prefix', forms: ['m', 'mu', 'mi', 'me'] },
    { id: 'AF.m', type: 'prefix', form: 'm', free: false },
    ...['ma', 'pa', 'ka', 'sa', 'ta', 'pu', 'pi', 'si', 'ku', 'tu', 'maka', 'paka', 'maxa', 'mata', 'pasi', 'kali'].map((form) => ({ id: `pre.${form}`, type: 'prefix', form })),
    { id: 'HORT', type: 'prefix', form: 'ta', free: false },
    { id: 'PROG', type: 'infix', form: 'a' },
    { id: 'PRF', type: 'infix', form: 'in' },
    { id: 'LF', type: 'suffix', form: 'an' },
    { id: 'PF', type: 'suffix', forms: ['en', 'un'] },
    { id: 'IMP', type: 'suffix', form: 'i' },
    { id: 'IRR', type: 'suffix', form: 'ay' },
    { id: 'RED.CV', type: 'reduplication', pattern: 'CV' },
    { id: 'RED.Ca', type: 'reduplication', pattern: 'Ca' },
    { id: 'RED.CVCV', type: 'reduplication', pattern: 'CVCV' },
  ],
  constructions: [
    { id: 'AF.PFV', sequence: ['AF', 'PRF'] },
    { id: 'CAUS.PFV', sequence: ['pre.pa', 'PRF'] },
    { id: 'UVL.PFV', sequence: ['PRF', 'LF'] },
    { id: 'UVP.PROG', sequence: ['RED.CV', 'PF'] },
    { id: 'HORT.IMP', sequence: ['HORT', 'IMP'] },
  ],
  alternations: [
    { underlying: 'p', surface: 'b', position: 'final', cost: 0.05 },
    { underlying: 't', surface: 'd', position: 'final', cost: 0.05 },
    { underlying: 'k', surface: 'g', position: 'final', cost: 0.05 },
    ...['a', 'e', 'i', 'u'].map((v) => ({ underlying: v, surface: `${v}'`, position: 'final', cost: 0 })),
  ],
}

/** @param {number} seed 可重現的亂數 */
export function rng(seed) {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  /** @template T @param {T[]} a @returns {T} */
  const pick = (a) => a[Math.floor(next() * a.length)]
  return { next, pick, chance: (/** @type {number} */ p) => next() < p }
}

const VOWELS = new Set(['a', 'e', 'i', 'u'])
const ONSETS = ['p', 't', 'k', 'b', 'd', 'm', 'n', 's', 'z', 'x', 'h', 'r', 'l', 'w', 'y', "'", 'p', 't', 'k', 's', 'r', 'h']
const CODAS = ['p', 't', 'k', 's', 'x', 'h', 'n', 'l', 'r', 'w', 'y', 't', 'k', 'n']
const NUCLEI = ['a', 'a', 'a', 'i', 'i', 'u', 'u', 'e']
const SHAPES = ['CVCVC', 'CVCVC', 'CVCVC', 'CVCV', 'VCVC', 'CVVCV', 'CVCVCVC']
const PREFIXES = ['mu', 'mi', 'ma', 'pa', 'ka', 'sa', 'ta', 'pu', 'pi', 'si', 'ku', 'tu', 'maka', 'paka', 'maxa', 'mata', 'pasi', 'kali']
const SUFFIXES = ['an', 'en', 'un', 'i', 'ay']

/** @param {string} w */
const onsetOf = (w) => {
  let k = 0
  while (k < w.length && !VOWELS.has(w[k])) k++
  return w.slice(0, k)
}

/** @param {ReturnType<typeof rng>} r */
function randomRoot(r) {
  const shape = r.pick(SHAPES)
  return [...shape].map((c, k) => (c === 'V' ? r.pick(NUCLEI) : k === shape.length - 1 ? r.pick(CODAS) : r.pick(ONSETS))).join('')
}

/**
 * @typedef {object} Derivation 一個衍生詞與它真正的推導
 * @property {string} root
 * @property {string} word
 * @property {number} cost 步驟成本加上用到的構詞音變
 * @property {boolean} regular 依規則、BCDP 表達得了（找得到詞根是正確性的要求）
 */

/**
 * @param {ReturnType<typeof rng>} r
 * @param {string} root
 * @returns {Derivation | null}
 */
function derive(r, root) {
  const kind = r.pick(['prefix', 'prefix', 'suffix', 'suffix', 'infix', 'redup', 'circumfix', 'prefix+suffix', 'prefix+prefix', 'suffix*2', 'prefix*4', 'infix+redup'])
  /** @type {string[]} */
  let pre = []
  /** @type {string[]} */
  let suf = []
  let stem = root
  let steps = 0
  if (kind === 'prefix') pre = [r.pick(PREFIXES)]
  else if (kind === 'suffix') suf = [r.pick(SUFFIXES)]
  else if (kind === 'prefix+suffix') (pre = [r.pick(PREFIXES)]), (suf = [r.pick(SUFFIXES)])
  else if (kind === 'prefix+prefix') pre = [r.pick(PREFIXES), r.pick(PREFIXES)]
  else if (kind === 'suffix*2') suf = [r.pick(SUFFIXES), r.pick(SUFFIXES)]
  else if (kind === 'prefix*4') pre = [r.pick(PREFIXES), r.pick(PREFIXES), r.pick(PREFIXES), r.pick(PREFIXES)]
  if (kind === 'infix' || kind === 'infix+redup') {
    const head = onsetOf(stem)
    stem = head + r.pick(['in', 'a']) + stem.slice(head.length)
    steps++
  }
  if (kind === 'redup' || kind === 'infix+redup') {
    const head = onsetOf(stem)
    if (head.length === stem.length) return null
    stem = (r.chance(0.5) ? head + stem[head.length] : `${head}a`) + stem
    steps++
  }
  if (kind === 'circumfix') {
    // 組合規則：p<in>a-、<in>…-an、RED.CV…-en
    const c = r.pick(['pina', 'in-an', 'red-en'])
    if (c === 'pina') pre = ['pina']
    else if (c === 'in-an') {
      const head = onsetOf(stem)
      stem = head + 'in' + stem.slice(head.length)
      suf = ['an']
    } else {
      const head = onsetOf(stem)
      if (head.length === stem.length) return null
      stem = head + stem[head.length] + stem
      suf = ['en']
    }
    steps = 1 - pre.length - suf.length
  }
  // 交界的構詞音變：詞尾 p t k 濁化（0.05）、元音結尾接詞綴時的喉塞音（0）
  let altCost = 0
  let w = stem
  suf.slice().reverse().forEach((form, k) => {
    const last = w[w.length - 1]
    if (k === 0 && 'ptk'.includes(last) && r.chance(0.4)) {
      w = w.slice(0, -1) + { p: 'b', t: 'd', k: 'g' }[/** @type {'p' | 't' | 'k'} */ (last)]
      altCost += 0.05
    } else if (VOWELS.has(last) && r.chance(0.5)) w += "'"
    w += form
  })
  for (const form of pre.slice().reverse()) {
    if (VOWELS.has(w[0]) && VOWELS.has(form[form.length - 1]) && r.chance(0.4)) w = `'${w}`
    w = form + w
  }
  const regular = !['suffix*2', 'prefix*4', 'infix+redup'].includes(kind)
  const cost = Math.round(((steps + pre.length + suf.length) * 0.1 + altCost) * 100) / 100
  return { root, word: w, cost, regular }
}

/**
 * 一份合成語料：詞根（約 30% 不在詞庫中，只有衍生詞）、衍生詞（60% 是辭典條目，其餘只在例句中）、干擾詞。
 * @param {number} seed
 * @param {number} nRoots
 */
export function morphCorpus(seed, nRoots) {
  const r = rng(seed)
  /** @type {Set<string>} */
  const roots = new Set()
  while (roots.size < nRoots) {
    const x = randomRoot(r)
    if (x.length >= 4) roots.add(x)
  }
  const lexical = new Set([...roots].filter(() => r.chance(0.7)))
  /** @type {Derivation[]} */
  const derivations = []
  for (const root of roots) {
    for (let k = 0; k < 2 + Math.floor(r.next() * 3); k++) {
      const d = derive(r, root)
      if (d && d.word !== root && !roots.has(d.word) && !derivations.some((x) => x.word === d.word)) derivations.push(d)
    }
  }
  /** @type {any[]} */
  const records = []
  let id = 0
  /** @param {string} text @param {string} [unit] @param {string} [source] */
  const add = (text, unit = 'word', source = 'dict') =>
    records.push(createRecord({ source, localId: `r${id++}`, unit: /** @type {any} */ (unit), text, citation: createCitation(`${source} ${id}`) }, { senses: [createSense({ zh: text })] }))
  for (const root of lexical) add(root)
  /** @type {string[]} */
  const inSentences = []
  for (const d of derivations) if (r.chance(0.6)) add(d.word)
  else inSentences.push(d.word)
  for (let k = 0; k < nRoots / 4; k++) add(randomRoot(r))
  for (let k = 0; k < inSentences.length; k += 3) add(inSentences.slice(k, k + 3).join(' '), 'sentence', 'corpus')
  return { lexical, derivations, records }
}

/**
 * @param {any[]} records
 * @param {Record<string, any>} [morphology] 合併進構詞規格的欄位（例如 rootSyllableCost）
 */
export function buildMorphEngine(records, morphology = {}) {
  const profile = { ...PAZEH_PROFILE, morphology: { ...PAZEH_LIKE_GRAMMAR, ...morphology } }
  const built = JSON.parse(JSON.stringify(buildSearchIndex({ items: records.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict', 'corpus'], profile })))
  const derivations = buildDerivationGraph(built)
  const parses = buildParseChart(built)
  return { derivations, parses, engine: new SearchEngine({ ...built, derivations, parses }) }
}
