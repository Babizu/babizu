/**
 * 句型搜尋測試用的合成資料：仿照巴宰語的構詞文法（同位詞素、中綴、組合規則）與幾個例句。
 * 詞與句子都是測試用的合成資料（寫法仿照巴宰語，但不是取自任何來源）。
 */

import { createCitation, createRecord, createSense } from '../../src/schema/index.js'
import { buildDerivationGraph, buildSearchIndex, SearchEngine } from '../../src/search/index.js'
import { PAZEH_PROFILE } from '../fixtures/pazeh.js'

/** 構詞文法：主事焦點的同位詞素組 {m, mu, mi, me}、中綴 <in> <a>、組合規則（docs/morph-grammar.md） */
export const PATTERN_GRAMMAR = {
  cost: 0.1,
  minStem: 3,
  maxSteps: 3,
  morphemes: [
    { id: 'AF', type: 'prefix', forms: ['m', 'mu', 'mi', 'me'], gloss: { 'zh-TW': '主事焦點', en: 'AF' } },
    { id: 'AF.m', type: 'prefix', form: 'm', free: false, gloss: { 'zh-TW': '主事焦點', en: 'AF' } },
    { id: 'STAT', type: 'prefix', form: 'ma', gloss: { 'zh-TW': '靜態', en: 'STAT' } },
    { id: 'CAUS', type: 'prefix', form: 'pa', gloss: { 'zh-TW': '使役', en: 'CAUS' } },
    { id: 'KA', type: 'prefix', form: 'ka' },
    { id: 'PRF', type: 'infix', form: 'in', gloss: { 'zh-TW': '完成貌', en: 'PFV' } },
    { id: 'PROG', type: 'infix', form: 'a', gloss: { 'zh-TW': '非完成貌', en: 'PROG' } },
    { id: 'PF', type: 'suffix', forms: ['en', 'un'], gloss: { 'zh-TW': '受事焦點', en: 'PF' } },
    { id: 'IMP', type: 'suffix', form: 'i', gloss: { 'zh-TW': '祈使', en: 'IMP' } },
    { id: 'IRR', type: 'suffix', form: 'ay' },
    { id: 'HORT', type: 'prefix', form: 'ta', free: false },
    { id: 'RED.CV', type: 'reduplication', pattern: 'CV' },
  ],
  constructions: [
    { id: 'AF.PFV', sequence: ['AF', 'PRF'] },
    { id: 'STAT.PFV', sequence: ['STAT', 'PRF'] },
    { id: 'CAUS.PFV', sequence: ['CAUS', 'PRF'] },
    { id: 'AF.PROG', sequence: ['AF.m', 'PROG'] },
    { id: 'HORT.IMP', sequence: ['HORT', 'IMP'] },
  ],
}

/** @param {string} localId @param {string} unit @param {string} text */
const rec = (localId, unit, text) => createRecord({ source: 'dict', localId, unit, text, citation: createCitation(`dict ${localId}`) }, { senses: [createSense({ zh: text })] })

export const RECORDS = [
  // 詞根
  ...['kita', 'kan', 'eken', 'baket', 'putiuk', 'hapuy', 'kawas', 'idem'].map((w) => rec(w, 'word', w)),
  // 加綴的詞
  ...['mikita', 'mukita', 'pakita', 'pinakita', 'minukan', 'mineken', 'binaket', 'mukan', 'makan', 'minakan', 'takani', 'paputiuk', 'pakan', 'kikita', 'midemen', 'kitaun'].map((w) => rec(w, 'word', w)),
  // 例句
  rec('s1', 'sentence', 'paputiuk ki hapuy'),
  rec('s2', 'sentence', 'yaku ka maha isiw usa humak.'),
  rec('s3', 'sentence', 'yaku ka hapet isiw'),
  rec('s4', 'sentence', 'yaku ka mausay mikita isiw a mamai kuasayan nahaza ezaw isiw'),
  rec('s5', 'sentence', 'minukan yaku ki saw'),
  rec('s6', 'sentence', 'mineken ki kawas'),
  rec('s7', 'sentence', 'mikita isiw ki saw'),
  rec('s8', 'sentence', 'pinakita ki saw. yaku ka isiw'),
  rec('s9', 'sentence', 'yaku (ka) mupuza lia.'),
  rec('s10', 'sentence', 'yaku nahaza mama iu/*maki iah.'),
  rec('s11', 'sentence', 'mokan ki saw'),
  rec('s12', 'sentence', 'takani ki kawas!'),
]

/** @param {object | null} [morphology] null：沒有構詞規格 */
export function buildPatternEngine(morphology = PATTERN_GRAMMAR) {
  const profile = morphology ? { ...PAZEH_PROFILE, morphology } : { ...PAZEH_PROFILE }
  const built = JSON.parse(JSON.stringify(buildSearchIndex({ items: RECORDS.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict'], profile })))
  return new SearchEngine({ ...built, derivations: buildDerivationGraph(built) })
}
