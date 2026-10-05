/**
 * 人工拆解對照（src/search/segmentation.js）與檢查清單的「人工拆解對照」（Checklist.segmentationPage）：
 * - 人工拆解的解析（萊比錫標註規則：`-` `=` `~` `<x>` `( )`）；
 * - 對照與句型搜尋的構詞樣式是同一個判斷：三種模糊程度下，對、誤配、漏的總數與直接用句型搜尋數出來的相同；
 * - 每筆記錄的詞綴狀態（比到、漏、規格沒有）、誤配、詞根在不在詞庫、同一個詞幾筆拆解取聯集；
 * - 檢查清單只列被扣分的記錄、篩選與數量、分頁，以及沒有人工拆解或構詞規格時不出現。
 * 資料是合成的（test/pattern/fixture.js 的構詞文法與詞，另加幾個測試用的詞）。
 */

import { describe, expect, it } from 'vitest'
import { Checklist, collectSegmentations, compareSegmentations, parseSegmentation, SEGMENTATIONS_FORMAT_VERSION } from '../../src/search/index.js'
import { buildPatternData, buildPatternEngine, rec, RECORDS } from '../pattern/fixture.js'

/** 詞 → 人工拆解 */
const SEGMENTATIONS = {
  mikita: 'mi-kita',
  pakita: 'pa-kita',
  pinakita: 'p<in>a-kita',
  minukan: 'm<in>u-kan',
  mineken: 'm<in>-eken',
  binaket: 'b<in>aket',
  mukan: 'mu-kan',
  makan: 'ma-kan',
  takani: 'ta-kan-i',
  paputiuk: 'pa-putiuk',
  midemen: 'm-idem-en',
  kitaun: 'kita-un',
  kikita: 'ki~kita', // 只有重疊：沒有要比的詞綴
  pakan: 'pak-an', // -an 不在構詞規格中；搜尋拆成 pa- ＋ kan：誤配
  mubazu: 'mu-bazu', // 詞根不在詞庫，搜尋以詞庫外的詞根拆到
  pikita: 'pa-kita', // 詞面是 pi-，搜尋拆不到：漏
  pibaket: 'pa-baket', // 同上（漏與誤配的數量不同，準確與召回才分得出來）
  kita: 'kita', // 沒有詞素界：不收
}
const RECORDS_WITH_SEGMENTATIONS = [...RECORDS, rec('mubazu', 'word', 'mubazu'), rec('pikita', 'word', 'pikita'), rec('pibaket', 'word', 'pibaket'), rec('mineken-2', 'word', 'mineken')].map((r) => {
  // mineken 的第二筆拆解把 m-<in> 合寫成 min-：組合寫法不比（規格沒有）；同一個詞的拆解取聯集，所以 m-、<in> 都不算誤配
  const seg = r.localId === 'mineken-2' ? 'min-eken' : r.unit === 'word' ? /** @type {Record<string, string>} */ (SEGMENTATIONS)[r.text] : undefined
  return seg ? { ...r, morphology: { formType: null, segmentation: seg, gloss: null, derivedFrom: [] } } : r
})
const engine = buildPatternEngine(undefined, RECORDS_WITH_SEGMENTATIONS)
const data = collectSegmentations(RECORDS_WITH_SEGMENTATIONS.map((record) => ({ record })))
const FUZZY_LEVELS = /** @type {const} */ (['exact', 'normal', 'loose'])
/** @param {string} s */
const key = (s) => s.toLowerCase()

describe('人工拆解的解析', () => {
  it('取最外層的前綴、最外層的後綴與所有中綴；詞根是最長的一段', () => {
    expect(parseSegmentation('pa-ka-kita', key)).toEqual({ affixes: [{ type: 'prefix', form: 'pa' }], root: 'kita' })
    expect(parseSegmentation('m<in>u-kan', key)).toEqual({
      affixes: [
        { type: 'prefix', form: 'mu' },
        { type: 'infix', form: 'in' },
      ],
      root: 'kan',
    })
    expect(parseSegmentation('m-idem-en', key)).toEqual({
      affixes: [
        { type: 'prefix', form: 'm' },
        { type: 'suffix', form: 'en' },
      ],
      root: 'idem',
    })
  })

  it('= 是附著詞界；~ 前面那一段是重疊部分，不是詞綴；( ) 中的字母保留、拿掉括號', () => {
    expect(parseSegmentation('kita=en', key)).toEqual({ affixes: [{ type: 'suffix', form: 'en' }], root: 'kita' })
    expect(parseSegmentation('ki~kita-i', key)).toEqual({ affixes: [{ type: 'suffix', form: 'i' }], root: 'kita' })
    expect(parseSegmentation('ma-ka(s)ay', key)).toEqual({ affixes: [{ type: 'prefix', form: 'ma' }], root: 'kasay' })
  })

  it('詞綴與詞根都轉成搜尋鍵；一樣長時取第一段為詞根；沒有任何一段時為 null', () => {
    expect(parseSegmentation('PA-Kita', key)).toEqual({ affixes: [{ type: 'prefix', form: 'pa' }], root: 'kita' })
    expect(parseSegmentation('kan-ita', key)).toEqual({ affixes: [{ type: 'suffix', form: 'ita' }], root: 'kan' })
    expect(parseSegmentation('', key)).toBeNull()
  })

  it('建置：只收有詞素界的拆解，記錄編號就是建置的順序；buildSearchIndex 的輸出帶著它（search/segmentations.json）', () => {
    expect(buildPatternData(undefined, RECORDS_WITH_SEGMENTATIONS).segmentations).toEqual(data)
    expect(data.version).toBe(SEGMENTATIONS_FORMAT_VERSION)
    const textOf = new Map(data.entries.map(([k, seg]) => [RECORDS_WITH_SEGMENTATIONS[k].text, seg]))
    expect(textOf.get('pakita')).toBe('pa-kita')
    expect(textOf.has('kita')).toBe(false)
    expect(data.entries).toHaveLength(Object.keys(SEGMENTATIONS).length) // 少了 kita，多了 mineken 的第二筆
  })
})

describe('對照與句型搜尋的構詞樣式是同一個判斷', () => {
  it.each(FUZZY_LEVELS)('%s：對、誤配、漏的總數與直接用句型搜尋數出來的相同', (fuzziness) => {
    const c = /** @type {NonNullable<ReturnType<typeof compareSegmentations>>} */ (compareSegmentations(engine, data.entries, fuzziness))
    // 每個條件以它的構詞樣式搜尋，命中的詞
    const hitWords = new Map(
      c.conditions.map((cond) => {
        const r = engine.searchPattern(cond.query, { fuzziness })
        expect(r.error, cond.query).toBeFalsy()
        return [cond.id, new Set(r.hits.flatMap((h) => h.matches.flatMap((m) => m.cells.map((cell) => cell.key))))]
      }),
    )
    /** @type {Map<string, Set<string>>} */
    const truth = new Map()
    for (const r of c.rows) {
      const set = truth.get(r.word) ?? new Set()
      for (const a of r.affixes) if (a.condition) set.add(a.condition)
      truth.set(r.word, set)
    }
    const want = { tp: 0, fp: 0, fn: 0 }
    for (const r of c.rows) {
      for (const cond of c.conditions) {
        const got = /** @type {Set<string>} */ (hitWords.get(cond.id)).has(r.word)
        const gold = /** @type {Set<string>} */ (truth.get(r.word)).has(cond.id)
        if (got && gold) want.tp++
        else if (got) want.fp++
        else if (gold) want.fn++
      }
    }
    expect(c.totals).toEqual(want)
    expect(want.tp > 0 && want.fp > 0 && want.fn > 0).toBe(true)
  })
})

describe('每筆記錄', () => {
  const c = /** @type {NonNullable<ReturnType<typeof compareSegmentations>>} */ (compareSegmentations(engine, data.entries))
  /** @param {string} word */
  const rowsOf = (word) => c.rows.filter((r) => r.word === word)

  it('同位詞素組只算一個條件：mi-、mu-、m- 是同一個', () => {
    const af = c.conditions.filter((x) => x.type === 'prefix' && x.id.includes('mu'))
    expect(af).toHaveLength(1)
    for (const w of ['mikita', 'mukan', 'midemen']) expect(rowsOf(w)[0].affixes.find((a) => a.type === 'prefix')?.condition).toBe(af[0].id)
  })

  it('漏：pikita 的人工拆解有 pa-，搜尋拆不到（詞面是 pi-），也沒有任何拆法', () => {
    const [r] = rowsOf('pikita')
    expect(r.affixes).toEqual([{ type: 'prefix', form: 'pa', condition: 'prefix:pa', status: 'miss' }])
    expect(r.extras).toEqual([])
    expect(r.parses).toEqual([])
  })

  it('規格沒有的詞綴不比；搜尋比到、拆解沒有的是誤配；詞根不在詞庫中時標出來', () => {
    const [r] = rowsOf('pakan')
    expect(r.affixes).toEqual([{ type: 'suffix', form: 'an', condition: null, status: 'unknown' }])
    expect(r.extras).toEqual(['prefix:pa'])
    expect(r).toMatchObject({ root: 'pak', rootInLexicon: false })
    expect(r.parses[0]).toMatchObject({ root: 'kan', virtual: false })
  })

  it('詞庫外的詞根：mubazu 由搜尋的詞庫外讀法拆到，mu- 比到', () => {
    const [r] = rowsOf('mubazu')
    expect(r.affixes.map((a) => a.status)).toEqual(['match'])
    expect(r).toMatchObject({ root: 'bazu', rootInLexicon: false })
    expect(r.parses[0]).toMatchObject({ root: 'bazu', virtual: true })
  })

  it('同一個詞的幾筆拆解取聯集：mineken 第二筆合寫成 min-（幾個詞素的組合寫法，不比），m-、<in> 不算誤配', () => {
    const rows = rowsOf('mineken')
    expect(rows.map((r) => r.affixes.map((a) => `${a.form}:${a.status}`))).toEqual([['m:match', 'in:match'], ['min:unknown']])
    expect(rows.map((r) => r.extras)).toEqual([[], []])
  })

  it('只有重疊的拆解沒有要比的詞綴，搜尋也沒有比到任何條件', () => {
    expect(rowsOf('kikita')[0]).toMatchObject({ affixes: [], extras: [], root: 'kita', rootInLexicon: true })
  })
})

describe('檢查清單：人工拆解對照', () => {
  const checklist = new Checklist(engine, ['dict'])

  it('接上人工拆解之前沒有這份清單', () => {
    expect(checklist.segmentationCount()).toBeNull()
    expect(checklist.segmentationPage()).toBeNull()
  })

  it('只列被扣分的記錄（漏、誤配、規格沒有的詞綴），依詞排序；數量、準確與召回', () => {
    checklist.attachSegmentations(data)
    expect(checklist.segmentationCount()).toBe(data.entries.length)
    const page = /** @type {NonNullable<ReturnType<Checklist['segmentationPage']>>} */ (checklist.segmentationPage())
    expect(page.items.map((x) => x.word)).toEqual(['mineken', 'pakan', 'pibaket', 'pikita'])
    expect(page.counts).toEqual({ all: 4, miss: 2, extra: 1, unknown: 2, rootMissing: 1 })
    expect(page.records).toBe(data.entries.length)
    const { tp, fp, fn } = /** @type {NonNullable<ReturnType<typeof compareSegmentations>>} */ (compareSegmentations(engine, data.entries)).totals
    expect(fp).not.toBe(fn) // 否則準確與召回相等，對調了也看不出來
    expect(page.totals).toEqual({ tp, fp, fn, precision: tp / (tp + fp), recall: tp / (tp + fn) })
  })

  it('每一項附上記錄、詞綴的構詞樣式（點了直接搜尋）與誤配的條件', () => {
    const [, pakan, , pikita] = /** @type {any} */ (checklist.segmentationPage()).items
    expect(pakan.doc.text).toBe('pakan')
    expect(pakan.affixes).toEqual([{ type: 'suffix', form: 'an', status: 'unknown', label: null, query: null }])
    expect(pakan.extras).toEqual([{ label: 'pa-', query: 'pa-…' }])
    expect(pikita.affixes).toEqual([{ type: 'prefix', form: 'pa', status: 'miss', label: 'pa-', query: 'pa-…' }])
  })

  it('篩選與分頁；詞根不在詞庫只算有不一致的記錄（mubazu 全部比到，不列）', () => {
    /** @param {object} o */
    const words = (o) => /** @type {any} */ (checklist.segmentationPage(o)).items.map((/** @type {any} */ x) => x.word)
    expect(words({ filter: 'miss' })).toEqual(['pibaket', 'pikita'])
    expect(words({ filter: 'extra' })).toEqual(['pakan'])
    expect(words({ filter: 'unknown' })).toEqual(['mineken', 'pakan'])
    expect(words({ filter: 'rootMissing' })).toEqual(['pakan'])
    expect(words({ limit: 1 })).toEqual(['mineken'])
    expect(words({ offset: 1, limit: 1 })).toEqual(['pakan'])
    expect(checklist.segmentationPage({ filter: 'miss', limit: 0 })?.total).toBe(2)
  })

  it('格式版本不符、沒有這個檔案（null）或沒有構詞規格時沒有這份清單', () => {
    const other = new Checklist(engine, ['dict'])
    other.attachSegmentations({ version: SEGMENTATIONS_FORMAT_VERSION + 1, entries: data.entries })
    expect(other.segmentationPage()).toBeNull()
    other.attachSegmentations(null)
    expect(other.segmentationPage()).toBeNull()
    const plain = new Checklist(buildPatternEngine(null, RECORDS_WITH_SEGMENTATIONS), ['dict'])
    plain.attachSegmentations(data)
    expect(plain.segmentationPage()).toBeNull()
  })
})
