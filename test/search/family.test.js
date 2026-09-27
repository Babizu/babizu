/**
 * 詞條家族（src/search/family.js）：上層記錄的計算，以及搜尋結果依家族分組、排序。
 * 資料是合成的，仿照《巴宰語詞典》kita- 條的結構：詞根條目底下有詞形、詞形底下還有詞形與例句，
 * 另有另立條目的衍生詞（「< kita-」）。
 */

import { describe, expect, it } from 'vitest'
import { createCitation, createGroup, createRecord, createSense } from '../../src/schema/index.js'
import { buildEntryGroups, collectHits, computeParents, derivationCandidates } from '../../src/search/family.js'
import { SearchEngine, buildSearchIndex } from '../../src/search/index.js'
import { createTextTools } from '../../src/search/text.js'
import { PAZEH_PROFILE } from '../fixtures/pazeh.js'

const { searchKey } = createTextTools(PAZEH_PROFILE)

/** 詞條群組 */
const entry = (/** @type {string} */ localId, /** @type {string} */ title) => createGroup({ source: 'dict', localId, type: 'entry', title })

/**
 * @param {string} localId
 * @param {string} text
 * @param {{group?: string, role?: string, parent?: string | null, unit?: string, from?: string, source?: string, related?: any[]}} [o]
 */
function rec(localId, text, o = {}) {
  const source = o.source ?? 'dict'
  return createRecord(
    { source, localId, unit: /** @type {any} */ (o.unit ?? 'word'), text, citation: createCitation(`${source} ${localId}`) },
    {
      senses: [createSense({ zh: text })],
      group: o.group ? { id: `${source}:${o.group}`, role: /** @type {any} */ (o.role ?? 'head'), parent: o.parent ? `${source}:${o.parent}` : null, seq: 0 } : null,
      morphology: o.from ? { formType: 'free', segmentation: null, gloss: null, derivedFrom: [{ relation: '<', text: o.from }] } : null,
      related: o.related ?? [],
    },
  )
}

const groups = [
  entry('kita', 'kita-'),
  entry('pakita', 'pakita'),
  entry('mikita', 'mikita'),
  entry('apu1', 'apu'),
  entry('apu2', 'apu'),
  entry('apuan', 'apuan'),
  entry('bair', 'bair-'),
  entry('kabaibair', 'kabaibair'),
  entry('aaa', 'aaa'),
  entry('bbb', 'bbb'),
  createGroup({ source: 'list', localId: 'c1', type: 'category', title: '類別 1' }),
]

const records = [
  rec('kita', 'kita-', { group: 'kita', unit: 'affix' }),
  rec('kita-f1', 'kinita', { group: 'kita', role: 'form' }),
  rec('kita-f2', 'pakita', { group: 'kita', role: 'form' }),
  rec('kita-x1', 'pakita saw', { group: 'kita', role: 'example', parent: 'kita-f2', unit: 'phrase' }),
  rec('kita-f3', 'pinakita', { group: 'kita', role: 'form', parent: 'kita-f2' }),
  rec('pakita', 'pakita', { group: 'pakita', from: 'kita-' }), // 另立條目，與 kita- 條下的 pakita 寫法相同
  rec('mikita', 'mikita', { group: 'mikita', from: 'kita-' }),
  rec('apu1', 'apu', { group: 'apu1' }),
  rec('apu2', 'apu', { group: 'apu2' }), // 同形異義詞
  rec('apuan', 'apuan', { group: 'apuan', from: 'apu' }),
  rec('bair', 'bair-', { group: 'bair', unit: 'affix' }),
  rec('kabaibair', 'kabaibair', { group: 'kabaibair', from: 'bair- = bail-' }),
  rec('aaa', 'aaaa', { group: 'aaa', from: 'bbbb' }), // 互相標為衍生自對方
  rec('bbb', 'bbbb', { group: 'bbb', from: 'aaaa' }),
  rec('c1-1', 'pakita', { group: 'c1', role: 'item', source: 'list' }), // 其他來源的同一個詞：分類詞表不是詞條家族
  rec('c1-2', 'kitakita', { group: 'c1', role: 'item', source: 'list', related: [{ type: 'derived-from', target: 'dict:kita' }] }),
]

const items = records.map((record) => ({ record, shard: 'all' }))
const parents = computeParents(items, groups, searchKey)
const indexOf = (/** @type {string} */ id) => records.findIndex((r) => r.id === id)
const parentOf = (/** @type {string} */ id) => {
  const p = parents[indexOf(id)]
  return p === -1 ? null : records[p].id
}

describe('上層記錄', () => {
  it('詞條群組內：group.parent，沒有指定時是詞目', () => {
    expect(parentOf('dict:kita-f1')).toBe('dict:kita')
    expect(parentOf('dict:kita-f2')).toBe('dict:kita')
    expect(parentOf('dict:kita-f3')).toBe('dict:kita-f2')
    expect(parentOf('dict:kita-x1')).toBe('dict:kita-f2')
    expect(parentOf('dict:kita')).toBeNull()
  })

  it('另立條目「< kita-」接到 kita- 條；註記（= bail-）去掉後再對', () => {
    expect(parentOf('dict:pakita')).toBe('dict:kita')
    expect(parentOf('dict:mikita')).toBe('dict:kita')
    expect(parentOf('dict:kabaibair')).toBe('dict:bair')
    expect(derivationCandidates("kuras 'thunder'")).toContain('kuras')
    expect(derivationCandidates('pizi-~ pidi-')).toEqual(expect.arrayContaining(['pizi-', 'pidi-']))
  })

  it('對不到唯一一個詞目（同形異義詞）時不連', () => {
    expect(parentOf('dict:apuan')).toBeNull()
  })

  it('明確的 derived-from 連結；分類詞表的項目沒有上層', () => {
    expect(parentOf('list:c1-2')).toBe('dict:kita')
    expect(parentOf('list:c1-1')).toBeNull()
  })

  it('循環被切斷：每筆記錄都走得到樹根', () => {
    const cut = ['dict:aaa', 'dict:bbb'].filter((id) => parentOf(id) === null)
    expect(cut).toHaveLength(1)
    for (let k = 0; k < parents.length; k++) {
      let x = k
      for (let steps = 0; x !== -1; steps++) {
        expect(steps).toBeLessThan(records.length)
        x = parents[x]
      }
    }
  })
})

const built = buildSearchIndex({ items, groups, sourceIds: ['dict', 'list'], profile: PAZEH_PROFILE })
const engine = new SearchEngine(JSON.parse(JSON.stringify(built)))

/** 家族樹 → 縮排的文字，方便比對結構 @param {any} node @returns {string[]} */
const outline = (node, depth = 0) => [
  `${'  '.repeat(depth)}${node.doc.id}${node.hit ? '' : ' (上層)'}${node.also.map((/** @type {any} */ a) => ` +${a.doc.id}`).join('')}`,
  ...node.children.flatMap((/** @type {any} */ c) => outline(c, depth + 1)),
]

describe('搜尋結果依詞條家族分組', () => {
  it('建索引時寫出 parent 欄', () => {
    expect(built.docs.parent).toEqual(parents)
  })

  it('查 pakita：kita- 條排第一，詞根在上、完全相同的 pakita 緊接其下；另立條目併成一列；其他來源另成一組', () => {
    const res = engine.search('pakita')
    const [first, ...rest] = res.entryGroups
    const lines = outline(first.root)
    expect(lines[0]).toMatch(/^dict:kita( \(上層\))?$/)
    expect(lines[1]).toBe('  dict:kita-f2 +dict:pakita')
    expect(lines).toContain('    dict:kita-x1')
    expect(first.best.score).toBe(0)
    // 兩個家族最好的命中同分（都是完全相同）：完全相同的命中較多的 kita- 條在前
    expect(rest.map((g) => g.root.doc.id)).toContain('list:c1-1')
    // 分組只是重新排列：每個命中恰好出現一次
    const grouped = res.entryGroups.flatMap((g) => collectHits(g.root).map((h) => h.doc.id)).sort()
    expect(grouped).toEqual(res.entries.map((h) => h.doc.id).sort())
    expect(res.totals.entryGroups).toBe(res.entryGroups.length)
  })

  it('查 pinakita：沒有命中的上層（kita-、pakita）也列出來，看得出 pinakita 在哪裡', () => {
    const [first] = engine.search('pinakita', { fuzziness: 'exact' }).entryGroups
    expect(outline(first.root)).toEqual(['dict:kita (上層)', '  dict:kita-f2 (上層)', '    dict:kita-f3'])
  })

  it('篩選掉的來源不會出現，上層記錄仍然照列', () => {
    const res = engine.search('pinakita', { fuzziness: 'exact', filters: { sources: ['list'] } })
    expect(res.entryGroups).toEqual([])
  })
})

describe('家族的排序（buildEntryGroups）', () => {
  /** 合成的命中：doc.index 就是 k @param {number} k @param {number} score */
  const hit = (k, score) => /** @type {any} */ ({ doc: { index: k, id: `r${k}`, text: `w${k}`, role: 'form' }, score, matchType: 'fuzzy', term: `w${k}` })
  const compareHits = (/** @type {any} */ a, /** @type {any} */ b) => a.score - b.score || a.doc.index - b.doc.index
  //  0 ─┬─ 1 ── 2
  //     └─ 3
  //  4（單獨）
  const parent = [-1, 0, 1, 0, -1]
  const ctx = { parent, doc: (/** @type {number} */ k) => /** @type {any} */ ({ index: k, id: `r${k}`, text: `w${k}`, role: 'form' }), key: (/** @type {string} */ s) => s, compareHits }

  it('家族的名次取最好的命中：深層的完全相同能把整個家族帶到前面，詞根仍在最上面', () => {
    const groups = buildEntryGroups([hit(4, 0.1), hit(0, 0.9), hit(2, 0)], ctx)
    expect(groups.map((g) => g.root.doc.index)).toEqual([0, 4])
    expect(groups[0].best.doc.index).toBe(2)
    expect(outline(groups[0].root)).toEqual(['r0', '  r1 (上層)', '    r2'])
  })

  it('同一層依子樹中最好的分數排，同分依原本的順序', () => {
    const groups = buildEntryGroups([hit(3, 0.2), hit(2, 0.5), hit(0, 0.9)], ctx)
    expect(groups[0].root.children.map((c) => c.doc.index)).toEqual([3, 1])
    const tie = buildEntryGroups([hit(3, 0.5), hit(2, 0.5)], ctx)
    expect(tie[0].root.children.map((c) => c.doc.index)).toEqual([1, 3])
  })

  it('最好的分數同分時：達到該分數的命中多的在前，再來是命中多的（以詞根身分命中的不算）', () => {
    // 0（單獨）；1 ── 2。compareHits 會偏好 doc.index 小的 r0，要由前兩個條件推翻
    const ctx2 = { ...ctx, parent: [-1, -1, 1] }
    const order = (/** @type {any[]} */ hits) => buildEntryGroups(hits, ctx2).map((g) => g.root.doc.index)
    expect(order([hit(0, 0), hit(1, 0), hit(2, 0)])).toEqual([1, 0]) // 完全相同的命中 2 對 1
    expect(order([hit(0, 0), hit(2, 0), hit(1, 0.5)])).toEqual([1, 0]) // 同樣 1 個完全相同，命中 2 對 1（查 kinawas）
    expect(order([hit(0, 0), hit(2, 0), { ...hit(1, 0.5), kind: 'root' }])).toEqual([0, 1]) // 以詞根身分命中的不算
    expect(order([hit(0, 0), { ...hit(2, 0), kind: 'root' }, hit(1, 0)])).toEqual([0, 1])
  })

  it('浮點誤差不影響同分的判斷', () => {
    const groups = buildEntryGroups([hit(3, 0.4 + 0.2), hit(2, 0.6)], ctx)
    expect(groups[0].root.children.map((c) => c.doc.index)).toEqual([1, 3])
  })
})
