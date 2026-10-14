/**
 * @file 測試用的構詞文法（仿巴宰語）：BCDP 套件的文法測試與 babizu 的以文法搜尋共用。
 */

/** 仿照巴宰語：主事焦點 m-／mu-／mi-／me-、非完成貌 <a>、完成貌 <in>、非實現 -ay（docs/morph-grammar.md） */
export const GRAMMAR = {
  cost: 0.2,
  minStem: 3,
  maxSteps: 3,
  morphemes: [
    { id: 'AF', type: 'prefix', forms: ['m', 'mu', 'mi', 'me'], gloss: { 'zh-TW': '主事焦點', en: 'AF' } },
    { id: 'STAT', type: 'prefix', form: 'ma', gloss: { 'zh-TW': '靜態', en: 'STAT' } },
    { id: 'KA', type: 'prefix', form: 'ka' },
    { id: 'TU', type: 'prefix', form: 'tu' },
    { id: 'IF', type: 'prefix', form: 'sa' },
    { id: 'PROG', type: 'infix', form: 'a', gloss: { 'zh-TW': '非完成貌', en: 'PROG' } },
    { id: 'PRF', type: 'infix', form: 'in', gloss: { 'zh-TW': '完成貌', en: 'PRF' } },
    { id: 'IRR', type: 'suffix', form: 'ay', gloss: { 'zh-TW': '非實現', en: 'IRR' } },
    { id: 'LF', type: 'suffix', form: 'an' },
    { id: 'RED.CV', type: 'reduplication', pattern: 'CV' },
    { id: 'HORT', type: 'prefix', form: 'ta', free: false },
    { id: 'HORT.aw', type: 'suffix', form: 'aw', free: false },
  ],
  constructions: [
    { id: 'AF.PFV', sequence: ['AF', 'PRF'], gloss: { 'zh-TW': '主事焦點・完成', en: 'AF.PFV' } },
    { id: 'KA.PFV', sequence: ['KA', 'PRF'] },
    { id: 'AF.PROG', sequence: ['AF', 'PROG'], gloss: { 'zh-TW': '主事焦點・非完成', en: 'AF.PROG' } },
    { id: 'AF.IRR', sequence: ['AF', 'PROG', 'IRR'], gloss: { 'zh-TW': '主事焦點・非實現', en: 'AF.IRR' } },
    { id: 'STAT.IRR', sequence: ['STAT', 'IRR'], gloss: { 'zh-TW': '靜態・非實現', en: 'STAT.IRR' } },
    { id: 'UVL.PFV', sequence: ['PRF', 'LF'] },
    { id: 'LF.IRR', sequence: ['LF', 'IRR'] },
    { id: 'UVL.PROG', sequence: ['RED.CV', 'IF'] },
    { id: 'HORT.UVP', sequence: ['HORT', 'HORT.aw'] },
  ],
}
