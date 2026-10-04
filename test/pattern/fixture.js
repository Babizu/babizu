/**
 * 句型搜尋測試用的合成資料：仿照巴宰語的構詞文法（同位詞素、中綴、組合規則）與幾個例句。
 * 詞與句子都是測試用的合成資料（寫法仿照巴宰語，但不是取自任何來源）。
 */

import { createCitation, createRecord, createSense } from '../../src/schema/index.js'
import { buildDerivationGraph, buildParseChart, buildSearchIndex, SearchEngine } from '../../src/search/index.js'
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
export const rec = (localId, unit, text) => createRecord({ source: 'dict', localId, unit, text, citation: createCitation(`dict ${localId}`) }, { senses: [createSense({ zh: text })] })

export const RECORDS = [
  // 詞根
  ...['kita', 'kan', 'eken', 'baket', 'putiuk', 'hapuy', 'kawas', 'idem', 'barak', 'rak'].map((w) => rec(w, 'word', w)),
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
  // 構詞樣式的取捨（拆解表，docs/pattern-query.md 第 4 節）：
  // kamikita 最好的拆法是 ka-mikita，差 0.1 的是 ka-mi-kita（像 imini 的 i-mini、i-m-ini）；
  // pakanen 最好的是 pakan-en，差 0.1 的是 pa-kan-en（次佳的拆法才有 pa-）；
  // bakita 只有靠 b→p 音變的 pa-kita；mupakita 最好的是 mu-pakita，差 0.1 的是 mu-pa-kita；
  // pabak 的 BCDP 最好的命中是 barak（與詞同長，不是拆法），拆法 rak 差 0.2（像 abak 的 a-pa-rak）
  rec('s13', 'sentence', 'kamikita ki saw'),
  rec('s14', 'sentence', 'pakanen isiw'),
  rec('s15', 'sentence', 'bakita ki hapuy'),
  rec('s16', 'sentence', 'mupakita yaku'),
  rec('s17', 'sentence', 'pabak isiw'),
  // 例句體例：(ka) 可以省略，讀法 pakakita 不在詞庫中（查詢時現算它的拆法）
  rec('s18', 'sentence', 'yaku pa(ka)kita isiw'),
  // ma(s)ay：讀法 masay 不在詞庫中，它的拆法只有虛擬詞根 asay（括號內外的片段都比 minStem 短，不會變成別的詞的詞根）
  rec('s19', 'sentence', 'ma(s)ay ki saw'),
]

/**
 * 建置輸出（docs.json、lexicon.json、language.json 的內容）
 * @param {object | null} [morphology] null：沒有構詞規格
 * @param {ReturnType<typeof rec>[]} [records]
 */
export function buildPatternData(morphology = PATTERN_GRAMMAR, records = RECORDS) {
  const profile = morphology ? { ...PAZEH_PROFILE, morphology } : { ...PAZEH_PROFILE }
  return JSON.parse(JSON.stringify(buildSearchIndex({ items: records.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict'], profile })))
}

/** @param {object | null} [morphology] null：沒有構詞規格 @param {ReturnType<typeof rec>[]} [records] */
export function buildPatternEngine(morphology = PATTERN_GRAMMAR, records = RECORDS) {
  const built = buildPatternData(morphology, records)
  return new SearchEngine({ ...built, derivations: buildDerivationGraph(built), parses: buildParseChart(built) })
}
