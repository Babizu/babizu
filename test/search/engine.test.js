import { describe, expect, it } from 'vitest'
import { createCitation, createRecord, createSense } from '../../src/schema/index.js'
import {
  SearchEngine,
  buildSearchIndex,
  computeDialectSupersets,
  createTextTools,
  decodePosting,
  encodePosting,
  glossTokens,
} from '../../src/search/index.js'
import { PAZEH_PROFILE } from '../fixtures/pazeh.js'

/** 測試用的語言變體：愛蘭是巴宰的地方變體 */
const VARIETIES = [
  { code: 'pazeh', parent: null },
  { code: 'kaxabu', parent: null },
  { code: 'auran', parent: 'pazeh' },
]
const { searchKey, splitWords, tokenize } = createTextTools(PAZEH_PROFILE)

/** 建一筆測試記錄 */
function rec(source, localId, unit, text, { zh = null, en = null, ...rest } = {}) {
  return createRecord(
    { source, localId, unit, text, citation: createCitation(`${source} ${localId}`) },
    { senses: zh || en ? [createSense({ zh, en })] : [], ...rest },
  )
}

const records = [
  rec('dict', 'e1', 'word', 'bintun', { zh: '星星', en: 'star', dialects: ['pazeh'] }),
  rec('dict', 'e12', 'word', 'muzikay', { zh: '愛蘭的詞', dialects: ['auran'] }),
  rec('dict', 'e9', 'word', 'pihilut', { zh: '尿', en: 'urine' }),
  rec('dict', 'e9-x1', 'sentence', 'usa pihilut!', { zh: '去尿尿！' }),
  rec('dict', 'e10', 'word', 'kakawas', { zh: '話' }),
  rec('dict', 'e2', 'word', 'baruzak', {
    zh: '豬',
    en: 'pig (domesticated)',
    variants: [{ relation: '=', text: 'barudak', attribution: 'Ogawa' }],
    group: { id: 'dict:e2', role: 'head', parent: null, seq: 0 },
  }),
  rec('dict', 'e2-x1', 'phrase', 'baruzak binayu', {
    zh: '野豬',
    en: 'wild pig',
    group: { id: 'dict:e2', role: 'example', parent: null, seq: 1 },
  }),
  rec('dict', 'e3', 'affix', 'sikis-', { zh: '痛', en: 'painful' }),
  rec('dict', 'e4', 'word', 'asikis', {
    zh: '痛',
    en: 'painful',
    morphology: { formType: 'free', segmentation: null, gloss: null, derivedFrom: [{ relation: '<', text: 'sikis-' }] },
  }),
  rec('list', 'r1', 'word', 'tamako', { zh: '斗笠', dialects: ['kaxabu'], altTexts: [{ system: 'pan-yongli', text: 'tà ma ko' }] }),
  rec('corpus', 's1', 'sentence', 'maakux haka haaput 這個 tamako', {
    zh: '天氣熱就要斗笠',
    dialects: ['kaxabu'],
    media: [{ type: 'audio', src: 'media/s1.mp3', start: null, end: null, available: true }],
  }),
  rec('corpus', 's2', 'sentence', 'yaku ka mudaux dalum.', { zh: '我喝水', en: 'I drink water.' }),
  rec('list', 'r2', 'word', 'bintul', { zh: '星星', dialects: ['kaxabu'] }),
  rec('list', 'r3', 'word', 'bintulan', { zh: '星空' }),
]

const shardOf = (r) => r.localId
const built = buildSearchIndex({
  items: records.map((record) => ({ record, shard: shardOf(record) })),
  groups: [{ id: 'dict:e2', source: 'dict', type: 'entry', title: 'baruzak', subtitle: null, citation: null, media: [] }],
  sourceIds: ['dict', 'list', 'corpus'],
  profile: PAZEH_PROFILE,
  varieties: VARIETIES,
})
const engine = new SearchEngine(JSON.parse(JSON.stringify(built)))

describe('文字處理', () => {
  it('searchKey 去除體例符號與附加符號', () => {
    expect(searchKey('Ma-dés')).toBe('madés')
    expect(searchKey('sikis-')).toBe('sikis')
    expect(searchKey('tà ma ko')).toBe('ta ma ko')
  })

  it('tokenize 拆出整詞與構詞部分', () => {
    expect(tokenize('imini ka tshay=a akhéhan?')).toEqual(['imini', 'ka', 'tshaya', 'tshay', 'akhéhan'])
    expect(tokenize('maatu-batan')).toEqual(['maatubatan', 'maatu', 'batan'])
    expect(tokenize("pubatu'i!")).toEqual(["pubatu'i"])
  })

  it('splitWords 只切整詞', () => {
    expect(splitWords('baruzak  binayu')).toEqual(['baruzak', 'binayu'])
  })

  it('glossTokens 去聲調符號並斷詞', () => {
    expect(glossTokens('thâu-mo•，mo•-hoat')).toEqual(['thau', 'mo', 'hoat'])
    expect(glossTokens('pig (domesticated)')).toEqual(['pig', 'domesticated'])
  })

  it('posting 編碼可還原', () => {
    expect(decodePosting(encodePosting(1234, 'variant'))).toEqual({ doc: 1234, kind: 'variant' })
  })
})

describe('SearchEngine', () => {
  it('跨方言模糊搜尋：bintul 找到 bintun，並說明規則', () => {
    const res = engine.search('bintul')
    const texts = res.entries.map((e) => e.doc.text)
    expect(texts[0]).toBe('bintul')
    const fuzzy = res.entries.find((e) => e.doc.text === 'bintun')
    expect(fuzzy?.distance).toBe(0.1)
    expect(fuzzy?.alignment?.[0]).toMatchObject({ source: 'l', target: 'n', category: '詞尾' })
  })

  it('變體、詞根、其他書寫系統都能命中詞條', () => {
    expect(engine.search('barudak').entries[0]).toMatchObject({ kind: 'variant', distance: 0 })
    const sikis = engine.search('sikis').entries.map((e) => [e.doc.text, e.kind])
    expect(sikis).toContainEqual(['sikis-', 'head'])
    expect(sikis).toContainEqual(['asikis', 'root'])
    expect(engine.search('ta ma ko').entries[0]).toMatchObject({ kind: 'alt' })
  })

  it('例句：單詞查詢找出句中出現的記錄，並附音檔', () => {
    const res = engine.search('tamako')
    expect(res.entries[0].doc.text).toBe('tamako')
    expect(res.occurrences.map((o) => o.doc.id)).toEqual(['corpus:s1'])
    expect(res.occurrences[0].doc.audio).toBe('media/s1.mp3')
  })

  it('例句：多詞查詢要求每個詞都出現', () => {
    const res = engine.search('baruzakbinayu')
    expect(res.entries[0].doc.text).toBe('baruzak binayu')
    const multi = engine.search('mudaux dalum')
    expect(multi.occurrences.map((o) => o.doc.id)).toEqual(['corpus:s2'])
    expect(engine.search('mudaux baruzak').occurrences).toEqual([])
  })

  it('例句不重複列出已在詞條區的記錄', () => {
    const res = engine.search('baruzak binayu')
    const ids = new Set(res.entries.map((e) => e.doc.id))
    expect(res.occurrences.some((o) => ids.has(o.doc.id))).toBe(false)
  })

  it('中文釋義搜尋：完全相同者排前面', () => {
    const res = engine.search('豬')
    expect(res.mode).toBe('zh')
    expect(res.glosses.map((g) => g.doc.text)).toEqual(['baruzak', 'baruzak binayu'])
    expect(res.glosses[0].rank).toBe(0)
    expect(engine.search('星 星').glosses).toHaveLength(2)
  })

  it('英文釋義搜尋：整詞與詞首', () => {
    const res = engine.search('pig')
    expect(res.glosses.map((g) => g.doc.text)).toEqual(['baruzak', 'baruzak binayu'])
    expect(engine.search('domest').glosses.map((g) => g.doc.text)).toEqual(['baruzak'])
  })

  it('篩選：來源、方言（含未標方言）、單位', () => {
    const bySource = engine.search('bintun', { filters: { sources: ['list'] } })
    expect(bySource.entries.map((e) => e.doc.id)).toEqual(['list:r2'])
    const byDialect = engine.search('bintun', { filters: { dialects: ['pazeh'] } })
    expect(byDialect.entries.map((e) => e.doc.id)).toEqual(['dict:e1'])
    const none = engine.search('baruzak', { filters: { dialects: ['none'] } })
    expect(none.entries.length).toBeGreaterThan(0)
    const units = engine.search('baruzak', { filters: { units: ['phrase'] } })
    expect(units.entries.every((e) => e.doc.unit === 'phrase')).toBe(true)
  })

  it('篩選：愛蘭是巴宰的地方變體，勾「巴宰」要一併出現', () => {
    const asPazeh = engine.search('muzikay', { filters: { dialects: ['pazeh'] } })
    expect(asPazeh.entries.map((e) => e.doc.id)).toEqual(['dict:e12'])
    // 反過來不成立：勾「愛蘭」不會帶出只標巴宰的記錄
    expect(engine.search('bintun', { filters: { dialects: ['auran'] } }).entries).toEqual([])
    expect(engine.search('muzikay', { filters: { dialects: ['kaxabu'] } }).entries).toEqual([])
  })

  it('變體的包含關係由 parent 算出（可多層），並寫進索引', () => {
    expect(built.docs.dialectSupersets).toEqual({ pazeh: ['pazeh', 'auran'], kaxabu: ['kaxabu'], auran: ['auran'] })
    const deep = computeDialectSupersets([
      { code: 'a' },
      { code: 'b', parent: 'a' },
      { code: 'c', parent: 'b' },
    ])
    expect(deep.a.sort()).toEqual(['a', 'b', 'c'])
    expect(() => computeDialectSupersets([{ code: 'x', parent: 'missing' }])).toThrow(/parent/)
    expect(() =>
      computeDialectSupersets([
        { code: 'x', parent: 'y' },
        { code: 'y', parent: 'x' },
      ]),
    ).toThrow(/循環/)
  })

  it('索引附上建立時用的語言設定檔；格式版本不符時拒絕載入', () => {
    expect(built.profile).toBe(PAZEH_PROFILE)
    const stale = JSON.parse(JSON.stringify(built))
    stale.docs.version = 1
    expect(() => new SearchEngine(stale)).toThrow(/重新建置/)
  })

  it('前綴比對：pihi 找到 pihilut（加權編輯距離差太遠，靠前綴索引補上）', () => {
    const res = engine.search('pihi')
    const hit = res.entries.find((e) => e.doc.text === 'pihilut')
    expect(hit).toMatchObject({ matchType: 'prefix', distance: 0 })
    // 句中出現也找得到
    expect(res.occurrences.map((o) => o.doc.text)).toContain('usa pihilut!')
  })

  it('包含比對：單一字母 k 找出所有含 k 的詞與句子', () => {
    const res = engine.search('k')
    const texts = res.entries.map((e) => e.doc.text)
    expect(texts).toContain('kakawas')
    expect(texts).toContain('tamako')
    expect(res.entries.every((e) => e.doc.text.toLowerCase().includes('k'))).toBe(true)
    expect(res.occurrences.length).toBeGreaterThan(0)
  })

  it('排序：精確與跨方言命中在前，前綴其次，包含最後', () => {
    const res = engine.search('bintul')
    expect(res.entries[0]).toMatchObject({ doc: { text: 'bintul' }, matchType: 'fuzzy', score: 0 })
    // 跨方言變體（0.1）仍排在前綴命中 bintulan 之前
    const texts = res.entries.map((e) => e.doc.text)
    expect(texts.indexOf('bintun')).toBeLessThan(texts.indexOf('bintulan'))
    // 分數單調遞增
    const scores = res.entries.map((e) => e.score)
    expect(scores).toEqual([...scores].sort((a, b) => a - b))
  })

  it('排序：前綴命中優先於距離較大的模糊命中', () => {
    const res = engine.search('pihi')
    const texts = res.entries.map((e) => e.doc.text)
    // pihilut 是前綴命中；若詞庫中有拼寫接近但距離較大的詞，前綴仍應排在前面
    expect(texts[0]).toBe('pihilut')
  })

  it('搜尋範圍：只搜族語或只搜釋義', () => {
    expect(engine.search('star', { fields: ['gloss'] }).glosses.length).toBeGreaterThan(0)
    expect(engine.search('star', { fields: ['gloss'] }).entries).toEqual([])
    expect(engine.search('star', { fields: ['native'] }).glosses).toEqual([])
    expect(engine.search('豬', { fields: ['native'] }).glosses).toEqual([])
    expect(engine.search('bintun', { fields: ['native'] }).entries.length).toBeGreaterThan(0)
  })

  it('中文查詢也會在族語欄位做包含比對（族語欄位可能夾雜中文註記）', () => {
    const idx = new SearchEngine(
      JSON.parse(
        JSON.stringify(
          buildSearchIndex({
            items: [{ record: rec('field', 'f1', 'phrase', 'xumak 青草', { zh: null }), shard: 'p1' }],
            groups: [],
            sourceIds: ['field'],
            profile: PAZEH_PROFILE,
          }),
        ),
      ),
    )
    expect(idx.search('青草').entries.map((e) => e.doc.text)).toEqual(['xumak 青草'])
  })

  it('中文查詢時，族語欄位完全相同的詞也要找到（不只找包含它的更長詞）', () => {
    const idx = new SearchEngine(
      JSON.parse(
        JSON.stringify(
          buildSearchIndex({
            items: [
              { record: rec('field', 'f1', 'word', '青草', { zh: null }), shard: 'p1' },
              { record: rec('field', 'f2', 'phrase', 'xumak 青草', { zh: null }), shard: 'p1' },
            ],
            groups: [],
            sourceIds: ['field'],
            profile: PAZEH_PROFILE,
          }),
        ),
      ),
    )
    const texts = idx.search('青草', { fields: ['native'] }).entries.map((e) => e.doc.text)
    // 完全相同的排前面
    expect(texts).toEqual(['青草', 'xumak 青草'])
  })

  it('list：依來源與單位列出，依詞形排序並可分頁', () => {
    const all = engine.list({ filters: { sources: ['dict'] } })
    expect(all.total).toBe(records.filter((r) => r.source === 'dict').length)
    expect(all.items.map((d) => d.text)).toEqual([...all.items.map((d) => d.text)].sort())

    const words = engine.list({ filters: { sources: ['dict'], units: ['word'] } })
    expect(words.items.every((d) => d.unit === 'word')).toBe(true)
    expect(words.total).toBe(words.items.length)

    const page = engine.list({ filters: { sources: ['dict'] }, offset: 1, limit: 2 })
    expect(page.items).toHaveLength(2)
    expect(page.items[0].id).toBe(all.items[1].id)
    expect(page.total).toBe(all.total)
  })

  it('精確模式不回傳模糊結果', () => {
    const res = engine.search('bintul', { fuzziness: 'exact' })
    // 仍會列出「開頭相符／包含」的詞，但不會有跨方言的模糊命中
    expect(res.entries.filter((e) => e.matchType === 'fuzzy').map((e) => e.doc.text)).toEqual(['bintul'])
    expect(res.entries.every((e) => e.matchType !== 'fuzzy' || e.distance === 0)).toBe(true)
  })

  it('跨來源相近詞排除同一群組', () => {
    const near = engine.neighbors('dict:e1')
    expect(near.map((h) => h.doc.id)).toContain('list:r2')
    expect(engine.neighbors('dict:e2').some((h) => h.doc.groupId === 'dict:e2')).toBe(false)
  })

  it('docById 與群組標題', () => {
    expect(engine.docById('dict:e2-x1')).toMatchObject({ groupTitle: 'baruzak', role: 'example', shard: 'e2-x1' })
    expect(engine.docById('nope')).toBeNull()
  })

  it('空查詢', () => {
    expect(engine.search('   ').entries).toEqual([])
  })
})
