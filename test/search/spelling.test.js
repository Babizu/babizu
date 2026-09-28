/**
 * 同形詞組（src/search/family.js 的 mergeSpellings）：寫法完全相同的單獨結果合成一項，家族維持原樣。
 * 資料是合成的，仿照 mikita、maturai 的情形：一部辭典（dict，有詞條家族）、兩份詞表（list、reed）。
 */

import { describe, expect, it } from 'vitest'
import { createCitation, createGroup, createRecord, createSense } from '../../src/schema/index.js'
import { SearchEngine, buildSearchIndex } from '../../src/search/index.js'
import { PAZEH_PROFILE } from '../fixtures/pazeh.js'

/**
 * @param {string} source
 * @param {string} localId
 * @param {string} text
 * @param {{zh?: string, group?: string, role?: string, from?: string, unit?: string}} [o]
 */
function rec(source, localId, text, o = {}) {
  return createRecord(
    { source, localId, unit: /** @type {any} */ (o.unit ?? 'word'), text, citation: createCitation(`${source} ${localId}`) },
    {
      senses: [createSense({ zh: o.zh ?? text })],
      group: o.group ? { id: `${source}:${o.group}`, role: /** @type {any} */ (o.role ?? 'head'), parent: null, seq: 0 } : null,
      morphology: o.from ? { formType: 'free', segmentation: null, gloss: null, derivedFrom: [{ relation: '<', text: o.from }] } : null,
    },
  )
}

const entry = (/** @type {string} */ localId, /** @type {string} */ title) => createGroup({ source: 'dict', localId, type: 'entry', title })
const groups = [entry('kita', 'kita-'), entry('mikita', 'mikita'), entry('apu1', 'apu'), entry('apu2', 'apu'), entry('apui', 'apui')]
const records = [
  // kita- 條：詞形 mikita，另有另立條目 mikita（< kita-），併在 kita- 條下的 mikita 那一列
  rec('dict', 'kita', 'kita-', { group: 'kita', unit: 'affix', zh: '看' }),
  rec('dict', 'kita-f1', 'mikita', { group: 'kita', role: 'form', zh: '看見' }),
  rec('dict', 'mikita', 'mikita', { group: 'mikita', from: 'kita-', zh: '看見' }),
  // 其他來源的 mikita：各自單獨
  rec('list', 'm1', 'mikita', { zh: '看，觀看' }),
  rec('list', 'm2', 'mikita', { zh: '看' }),
  // 寫法相同的兩筆合成一項；附加符號不同的 mātūrai 分開
  rec('reed', 'r1', 'maturai', { zh: 'sing' }),
  rec('reed', 'r2', 'maturai', { zh: 'song' }),
  rec('reed', 'r3', 'mātūrai', { zh: 'sing' }),
  // 同形異義的 apu：另立條目 apui（< apu）對不到唯一一個詞目，單獨存在；apu¹ 條下也有 apui，釋義相同
  rec('dict', 'apu1', 'apu', { group: 'apu1', zh: '祖母' }),
  rec('dict', 'apu1-f1', 'apui', { group: 'apu1', role: 'form', zh: '阿婆' }),
  rec('dict', 'apu2', 'apu', { group: 'apu2', zh: '九芎' }),
  rec('dict', 'apui', 'apui', { group: 'apui', from: 'apu', zh: '阿婆' }),
]
const built = buildSearchIndex({ items: records.map((record) => ({ record, shard: 'a' })), groups, sourceIds: ['dict', 'list', 'reed'], profile: PAZEH_PROFILE })
const engine = new SearchEngine(JSON.parse(JSON.stringify(built)))

/** 搜尋結果的詞條項目：家族寫樹根，同形詞組寫成員 @param {string} q */
const outline = (q) =>
  engine.search(q, { fields: ['native'] }).entryGroups.map((g) =>
    g.spelling ? `組 ${g.spelling.text}：${g.spelling.members.map((m) => `${m.doc.id}${m.family ? `（${m.family.text} 條下）` : ''}`).join('、')}` : g.root.doc.id,
  )

describe('同形詞組', () => {
  it('不同來源寫法相同的單獨結果合成一項；家族不變，家族中同樣寫法的命中另外列一份', () => {
    const items = outline('mikita')
    expect(items).toContain('dict:kita')
    expect(items).toContain('組 mikita：list:m1、list:m2、dict:mikita（kita- 條下）')
    // 家族排在前面（它的 mikita 是完全相符的詞形），同形詞組排在其中的單獨結果原本的位置
    expect(items.indexOf('dict:kita')).toBeLessThan(items.indexOf('組 mikita：list:m1、list:m2、dict:mikita（kita- 條下）'))
  })

  it('附加符號不同就是不同的寫法：maturai 兩筆成組，mātūrai 單獨一項', () => {
    const items = outline('maturai')
    expect(items).toContain('組 maturai：reed:r1、reed:r2')
    expect(items).toContain('reed:r3')
  })

  it('家族中的那一筆與單獨的結果同一來源、釋義也相同時不重複：apui 仍是單獨一項', () => {
    const items = outline('apui')
    expect(items.some((s) => s.startsWith('組 apui'))).toBe(false)
    expect(items).toContain('dict:apui')
  })

  it('同形詞組算一項：總數與截斷都以合併後的項目計算', () => {
    const response = engine.search('mikita', { fields: ['native'] })
    expect(response.totals.entryGroups).toBe(response.entryGroups.length)
  })
})
