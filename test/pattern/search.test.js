/**
 * 句型搜尋（src/pattern/search.js）：
 * - 構詞樣式的寫法與解析（同位詞素組、中綴不看位置、組合的整體寫法、方言寫法、引號）；
 * - 拆解表與 BCDP：拆解表就是自動派生圖建置時那一次 BCDP 的全部結果，也就是一般搜尋的自動拆解清單；
 * - 構詞樣式依模糊程度取拆法、詞綴從最外層算起（外側寫 … 不錨定）、詞根是 … 等於每個詞根合起來（三種模糊程度）；
 * - 與一般搜尋的一致：`kita`、`@kita` 找到的記錄與一般搜尋（排除其他搜尋方法）相同；
 * - 句與讀法、& 與 !、候選篩選不影響結果、頻率。
 * 資料是合成的（test/pattern/fixture.js）。
 */

import { describe, expect, it } from 'vitest'
import { buildDerivationGraph, buildParseChart, FUZZINESS, SearchEngine } from '../../src/search/index.js'
import { PARSE_SELECTION, selectParses } from '../../src/pattern/morph.js'
import { SEARCH_METHODS } from '../../src/search/scoring.js'
import { buildPatternData, buildPatternEngine, PATTERN_GRAMMAR, rec, RECORDS } from './fixture.js'

const engine = buildPatternEngine()
const graph = /** @type {NonNullable<typeof engine.derivations>} */ (engine.derivations)
const chart = /** @type {NonNullable<typeof engine.parses>} */ (engine.parses)
const FUZZY_LEVELS = /** @type {const} */ (['exact', 'normal', 'loose'])

/**
 * 一種拆法的詞素寫成構詞樣式：前綴（由外而內）、中綴、詞根、後綴（由內而外）、重疊。沒有任何詞綴時是 null。
 * @param {import('../../src/pattern/morph.js').MorphReading} reading
 * @param {string} root `…` 或引號中的詞根
 */
function patternOf(reading, root) {
  if (!reading.left.length && !reading.right.length && !reading.infixes.length && !reading.red) return null
  const pre = reading.left.map((m) => `${m.form}-`).join('')
  const inf = reading.infixes.map((m) => `<${m.form}>`).join('')
  const suf = reading.right.map((m) => `-${m.form}`).join('')
  return `${reading.red ? '~' : ''}${pre}${inf ? `${inf}-` : ''}${root}${suf}`
}

/** 句型搜尋，回傳命中的記錄文字 @param {string} q @param {object} [options] */
const docs = (q, options = {}) => {
  const r = engine.searchPattern(q, options)
  if (r.error) throw new Error(`${q}: ${JSON.stringify(r.error)}`)
  return r.hits.map((h) => h.doc.text)
}
/** 命中的詞（主條件的每一格，去重排序） @param {string} q @param {string} [fuzziness] */
const tokens = (q, fuzziness = 'normal') => {
  const r = engine.searchPattern(q, { fuzziness: /** @type {any} */ (fuzziness) })
  if (r.error) throw new Error(`${q}: ${JSON.stringify(r.error)}`)
  return [...new Set(r.hits.flatMap((h) => h.matches.filter((m) => m.cond === 0).flatMap((m) => m.cells.map((c) => c.key))))].sort()
}

describe('維護者的例子', () => {
  it('yaku ka _* isiw：中間隔任意幾個詞；_* 貪婪，延伸到同一句最後一個 isiw；不跨到下一句', () => {
    const r = engine.searchPattern('yaku ka _* isiw')
    const lines = r.hits.map((h) => h.doc.text.slice(h.matches[0].start, h.matches[0].end))
    expect(lines).toEqual(
      expect.arrayContaining([
        'yaku ka maha isiw',
        'yaku ka hapet isiw',
        'yaku ka mausay mikita isiw a mamai kuasayan nahaza ezaw isiw',
        // 「pinakita ki saw. yaku ka isiw」：第二句的 yaku ka isiw（_* 比到零個詞）
        'yaku ka isiw',
      ]),
    )
    expect(r.hits).toHaveLength(4)
  })

  it('pa-… ki _：paputiuk ki hapuy；paputiuk 是自動拆解 pa- ＋ putiuk', () => {
    const r = engine.searchPattern('pa-… ki _')
    const hit = r.hits.find((h) => h.doc.text === 'paputiuk ki hapuy')
    expect(hit).toBeDefined()
    const [pa, ki, any] = /** @type {any} */ (hit).matches[0].cells
    expect(pa.evidence).toMatchObject({ matchType: 'lemma', token: 'paputiuk', term: 'putiuk' })
    expect(ki.evidence).toMatchObject({ matchType: 'fuzzy', distance: 0 })
    expect(any).toMatchObject({ key: 'hapuy', evidence: null })
    // 原文位置：高亮用
    expect(hit?.doc.text.slice(pa.start, pa.end)).toBe('paputiuk')
  })
})

describe('構詞樣式：寫法與解析（docs/pattern-query.md 第 3 節的對照表）', () => {
  it('同位詞素組：mu-… ＝ mi-… ＝ m-… ＝ me-…；…-en ＝ …-un ＝ …=en', () => {
    const mu = tokens('mu-…')
    expect(mu).toEqual(expect.arrayContaining(['mikita', 'mukita', 'minukan', 'mineken', 'mukan', 'midemen']))
    for (const q of ['mi-…', 'm-…', 'me-…']) expect(tokens(q), q).toEqual(mu)
    const en = tokens('…-en')
    expect(en).toEqual(['kitaun', 'midemen', 'pakanen'])
    for (const q of ['…-un', '…=en', '-en']) expect(tokens(q), q).toEqual(en)
  })

  it('中綴不看位置：m<in>u-… ＝ m<in>-… ＝ m-<in>… ＝ m-<in>-… ＝ minu-…（寫出的是 mu，比的是整個同位詞素組）', () => {
    const want = tokens('m<in>u-…')
    expect(want).toEqual(['mineken', 'minukan'])
    for (const q of ['m<in>-…', 'm-<in>…', 'm-<in>-…', 'minu-…', 'mi<in>-…']) expect(tokens(q), q).toEqual(want)
    expect(tokens('<in>…')).toEqual(['binaket', 'minakan', 'mineken', 'minukan', 'pinakita'])
    // 中綴寫在詞根上：b<in>aket ＝ <in>baket ＝ <in>-baket（詞根 baket ＋ <in>）
    for (const q of ['b<in>aket', '<in>baket', '<in>-baket']) expect(tokens(q), q).toEqual(['binaket'])
  })

  it('比的是詞素：pa-… 也找得到 pinakita（pa ＋ <in>）', () => {
    // barak、bakita 是靠 b→p 音變的 pa-rak、pa-kita（標準容許少量音變）
    expect(tokens('pa-…')).toEqual(['bakita', 'barak', 'pakakita', 'pakan', 'pakanen', 'pakita', 'paputiuk', 'pinakita'])
  })

  it('引號只要那個寫法："mu"-… 不含 mikita、mineken，但含 mokan（BCDP 把 mo 分析成 mu）', () => {
    const t = tokens('"mu"-…')
    expect(t).toEqual(expect.arrayContaining(['mukita', 'minukan', 'mukan', 'mokan', 'mupuza']))
    expect(t).not.toContain('mikita')
    expect(t).not.toContain('mineken')
  })

  it('組合的整體寫法換成它的詞素：mina-… ＝ ma-<in>…', () => {
    expect(tokens('mina-…')).toEqual(['minakan'])
    expect(tokens('ma-<in>…')).toEqual(['minakan'])
  })

  it('方言寫法：mo-… 依 u↔o 視為 mu-（提示）；不認得的詞綴報錯並列出最接近的', () => {
    const r = engine.searchPattern('mo-…')
    expect(r.warnings.filter((w) => w.code !== 'W_INNER_AFFIX')).toEqual([expect.objectContaining({ code: 'W_AFFIX_VARIANT', params: { form: 'mo-', to: 'mu-' } })])
    // 改寫成不錨定時保留查詢的寫法（…-mo-…，同樣視為 mu-）
    expect(r.warnings.find((w) => w.code === 'W_INNER_AFFIX')?.params?.query).toBe('…-mo-…')
    expect(tokens('mo-…')).toEqual(tokens('mu-…'))
    const err = engine.searchPattern('b-…').error
    expect(err).toMatchObject({ code: 'E_UNKNOWN_AFFIX', start: 0, end: 1, params: { form: 'b-', side: 'prefix' } })
    expect(/** @type {any} */ (err).params.suggestions).toContain('pa-')
  })

  it('寫法有歧義時提示：ma- 是靜態 ma-，進行貌的 m<a>- 表面也寫成 ma', () => {
    expect(engine.searchPattern('ma-…').warnings).toEqual([expect.objectContaining({ code: 'W_ALSO_CONSTRUCTION', params: { form: 'ma-', parts: 'm- ＋ <a>' } })])
  })

  it('環綴；重疊；兩個條件都要成立', () => {
    expect(tokens('ta-…-i')).toEqual(['takani'])
    expect(tokens('~…')).toEqual(['kikita'])
    expect(tokens('m-<in>-…-en')).toEqual([])
  })

  it('沒有構詞規格的語言：構詞樣式報錯', () => {
    const plain = buildPatternEngine(null)
    expect(plain.searchPattern('pa-…').error).toMatchObject({ code: 'E_NO_MORPHOLOGY' })
    expect(plain.searchPattern('yaku ka _').hits.length).toBeGreaterThan(0)
  })
})

describe('拆解表：與自動派生圖、一般搜尋的自動拆解是同一次 BCDP', () => {
  /** @param {number} x */
  const round = (x) => Math.round(x * 1e6) / 1e6

  it('每個詞在拆解表中與 BCDP 最好的命中同分的詞庫詞根，就是自動派生圖這個詞的邊；虛擬詞根的邊也一樣', () => {
    /** @type {Map<number, string[]>} 詞 → 自動派生圖的邊（詞根:成本） */
    const edges = new Map()
    for (const [root, list] of graph.children) {
      for (const c of list) {
        const key = `${graph.nodes[root]}:${round(graph.analyses[c.analysis].cost)}${graph.isVirtual(root) ? '*' : ''}`
        edges.set(c.word, [...(edges.get(c.word) ?? []), key])
      }
    }
    let words = 0
    engine.index.terms.forEach((_, w) => {
      const parses = chart.of(w)
      const lexical = parses.filter((p) => !p.virtual)
      const best = chart.lexicalBestOf(w)
      const fromChart = [
        ...lexical.filter((p) => p.cost <= best + 1e-9).map((p) => `${p.root}:${round(p.cost)}`),
        ...parses.filter((p) => p.virtual).map((p) => `${p.root}:${round(p.cost)}*`),
      ]
      expect(fromChart.sort(), engine.index.terms[w]).toEqual((edges.get(w) ?? []).sort())
      if (parses.length) words++
    })
    expect(words).toBeGreaterThan(20)
  })

  it('精確模式取到的拆法，就是自動派生圖這個詞的邊（詞庫詞根同分全收、虛擬詞根）去掉音變超過上限的那些', () => {
    /** @type {Map<number, string[]>} */
    const edges = new Map()
    for (const [root, list] of graph.children) {
      for (const c of list) {
        const a = graph.analyses[c.analysis]
        const sound = a.cost - a.steps.reduce((sum, s) => sum + s.cost, 0)
        if (sound > PARSE_SELECTION.exact.sound + 1e-9) continue
        edges.set(c.word, [...(edges.get(c.word) ?? []), `${graph.nodes[root]}:${round(a.cost)}`])
      }
    }
    engine.searchPattern('_')
    const pattern = /** @type {any} */ (engine)._pattern
    let words = 0
    engine.index.terms.forEach((w, id) => {
      const exact = pattern._parsesOf(w, 'exact').map((/** @type {any} */ p) => `${p.root}:${round(p.cost)}`)
      expect(exact.sort(), w).toEqual((edges.get(id) ?? []).sort())
      if (exact.length) words++
    })
    expect(words).toBeGreaterThan(20)
  })

  it('虛擬詞根不把詞庫詞根的拆法擠掉：每個詞、每種模糊程度，取到的詞庫拆法與沒有虛擬詞根時相同', () => {
    engine.searchPattern('_')
    const pattern = /** @type {any} */ (engine)._pattern
    let checked = 0
    engine.index.terms.forEach((w, id) => {
      const all = chart.of(id)
      if (!all.some((p) => p.virtual)) return
      checked++
      for (const f of FUZZY_LEVELS) {
        const lexical = pattern._parsesOf(w, f).filter((/** @type {any} */ p) => !p.virtual).map((/** @type {any} */ p) => p.root)
        const alone = selectParses(all.filter((p) => !p.virtual), f, chart.lexicalBestOf(id)).map((p) => p.root)
        expect(lexical, `${w} ${f}`).toEqual(alone)
      }
    })
    expect(checked).toBeGreaterThan(1)
  })

  it('每個詞都找得到自己：依模糊程度取到的每一種拆法寫成構詞樣式（詞根寫 … 或引號中的詞根），這個詞在原文中的每一處都比到', () => {
    engine.searchPattern('_')
    const pattern = /** @type {any} */ (engine)._pattern
    const { texts, docsOf } = pattern.corpus
    /**
     * 詞在原文中的每一處（記錄、位置）。比位置不比詞形：同一個位置由好幾種讀法比到時只算一次，
     * 留下的是第一種讀法的詞形（pa(ka)kita 的 pakakita 或 pakita）
     * @param {string} w
     */
    const placesOf = (w) =>
      new Set(
        (docsOf.get(w) ?? []).flatMap((/** @type {number} */ k) =>
          texts[k].segments.flatMap((/** @type {any[][]} */ readings) => readings.flatMap((tokens) => tokens.filter((t) => t.key === w).map((t) => `${k}:${t.start}-${t.end}`))),
        ),
      )
    let checked = 0
    for (const f of FUZZY_LEVELS) {
      for (const w of docsOf.keys()) {
        const places = placesOf(w)
        for (const parse of pattern._parsesOf(w, f)) {
          const q = patternOf(parse.reading, '…')
          if (!q) continue
          for (const query of [q, patternOf(parse.reading, `"${parse.root}"`)]) {
            const r = engine.searchPattern(/** @type {string} */ (query), { fuzziness: f, limit: Infinity })
            expect(r.error, `${w} ${query} ${f}`).toBeNull()
            const hit = new Set(r.hits.flatMap((h) => h.matches.flatMap((m) => m.cells.map((c) => `${h.doc.index}:${c.start}-${c.end}`))))
            for (const place of places) expect(hit.has(place), `${w} ${query} ${f} ${place}`).toBe(true)
            checked++
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('拆解表中詞庫詞根的拆法，就是一般搜尋查這個詞時自動拆解列出的那些（詞根比詞短、單一個詞）', () => {
    const ms = /** @type {NonNullable<typeof engine.morphSearch>} */ (engine.morphSearch)
    const level = FUZZINESS.normal
    let checked = 0
    engine.index.terms.forEach((w, id) => {
      const prepared = ms.seed(ms.prepare(w, engine._lemmaMax(w, level)), engine.index)
      const lemma = prepared ? engine._lemmaTerms(w, level, prepared, engine.index.searchChannels(prepared.channels)) : []
      const plain = lemma.filter((t) => Array.from(t.term).length < Array.from(w).length && !t.term.includes(' ')).map((t) => `${t.term}:${round(t.distance)}`)
      const fromChart = chart.of(id).filter((p) => !p.virtual).map((p) => `${p.root}:${round(p.cost)}`)
      expect(fromChart.sort(), w).toEqual(plain.sort())
      checked += plain.length
    })
    expect(checked).toBeGreaterThan(30)
  })

  it('詞根是單一個詞：BCDP 可以把片語「ka kita」當成 pakakita 的詞根（與 kita 同分），拆解表不收；自動派生圖照舊', () => {
    const small = buildPatternEngine(undefined, [rec('a', 'phrase', 'ka kita'), rec('b', 'word', 'kita'), rec('c', 'word', 'pakakita')])
    const id = small.index.dawg.lookup('pakakita')
    const g = /** @type {NonNullable<typeof small.derivations>} */ (small.derivations)
    expect([...g.children].filter(([, list]) => list.some((c) => c.word === id)).map(([root]) => g.nodes[root]).sort()).toEqual(['ka kita', 'kita'])
    expect(/** @type {NonNullable<typeof small.parses>} */ (small.parses).of(id).map((p) => p.root)).toEqual(['kita'])
  })

  it('詞庫外的詞（例句體例展開的讀法 pakakita）：查詢時用建置時同一個函式現算拆法，與把它加進詞庫建置時相同', () => {
    engine.searchPattern('_')
    const pattern = /** @type {any} */ (engine)._pattern
    const unlisted = [...pattern.corpus.docsOf.keys()].filter((k) => engine.index.dawg.lookup(k) === -1)
    expect(unlisted).toEqual(expect.arrayContaining(['pakakita', 'masay']))
    // masay 只有虛擬詞根 asay 的拆法
    expect(pattern._unlistedParses('masay').all.map((/** @type {any} */ p) => [p.root, p.virtual])).toEqual([['asay', true]])
    const show = (/** @type {any[]} */ list) => list.map((p) => `${p.root}:${round(p.cost)}:${round(p.sound)}:${p.virtual}:${p.steps.map((s) => s.form).join('+')}`)
    for (const w of unlisted) {
      const other = buildPatternEngine(undefined, [...RECORDS, rec(`added-${w}`, 'word', w)])
      const otherChart = /** @type {NonNullable<typeof other.parses>} */ (other.parses)
      const id = other.index.dawg.lookup(w)
      const mine = pattern._unlistedParses(w)
      expect(show(mine.all), w).toEqual(show(otherChart.of(id)))
      expect(mine.floor, w).toBe(otherChart.lexicalBestOf(id))
    }
    // 找得到：yaku pa(ka)kita isiw 的讀法 yaku pakakita isiw；構詞樣式、不加引號的詞（相同與相近拼寫）、引號都比得到
    expect(docs('yaku pa-ka-…')).toEqual(['yaku pa(ka)kita isiw'])
    expect(docs('yaku pakakita')).toEqual(['yaku pa(ka)kita isiw'])
    expect(docs('yaku bakakita')).toEqual(['yaku pa(ka)kita isiw'])
    expect(docs('masay ki')).toEqual(['ma(s)ay ki saw'])
    expect(docs('"masay"')).toEqual(['ma(s)ay ki saw'])
  })

  it('sound 是整個詞的音變：成本扣掉各步驟的成本（bakita 的 b→p）', () => {
    const [p] = chart.of(engine.index.dawg.lookup('bakita'))
    expect(p).toMatchObject({ root: 'kita', virtual: false })
    expect(p.sound).toBeCloseTo(0.1)
    expect(p.cost).toBeCloseTo(p.sound + p.steps.reduce((s, x) => s + x.cost, 0))
  })
})

describe('構詞樣式：取哪些拆法跟著模糊程度，詞綴從最外層算起', () => {
  it('kamikita（ka-mikita 最好、ka-mi-kita 差 0.1，像 imini）：mi-… 不中；…-mi-… 在標準、寬鬆中，精確不中', () => {
    for (const f of FUZZY_LEVELS) expect(tokens('mi-…', f), f).not.toContain('kamikita')
    expect(tokens('…-mi-…', 'exact')).not.toContain('kamikita')
    expect(tokens('…-mi-…', 'normal')).toContain('kamikita')
    expect(tokens('…-mi-…', 'loose')).toContain('kamikita')
    for (const f of FUZZY_LEVELS) expect(tokens('ka-…', f), f).toContain('kamikita')
  })

  it('pakanen（pakan-en 最好、pa-kan-en 差 0.1）：次佳的拆法才帶 pa-，pa-… 在標準中、精確不中', () => {
    expect(tokens('pa-…', 'exact')).not.toContain('pakanen')
    expect(tokens('pa-…', 'normal')).toContain('pakanen')
    expect(tokens('pa-kan', 'normal')).toContain('pakanen')
    expect(tokens('pa-kan', 'exact')).not.toContain('pakanen')
  })

  it('bakita（只有靠 b→p 音變的 pa-kita，音變 0.1）：最好的拆法，精確、標準都中', () => {
    expect(tokens('pa-…', 'exact')).toContain('bakita')
    expect(tokens('pa-…', 'normal')).toContain('bakita')
  })

  it('pabak（BCDP 最好的命中是 barak：與詞同長，不是拆法）：取拆法從它算起，pa-pa-rak 差 0.2，標準不中、寬鬆中；自動派生圖也不建邊', () => {
    const id = engine.index.dawg.lookup('pabak')
    expect(chart.of(id).map((p) => p.root)).toEqual(['rak'])
    expect(chart.lexicalBestOf(id)).toBeCloseTo(0.2)
    expect([...graph.children].some(([, list]) => list.some((c) => c.word === id))).toBe(false)
    expect(tokens('pa-…', 'normal')).not.toContain('pabak')
    expect(tokens('pa-…', 'loose')).toContain('pabak')
  })

  it('mausay（詞庫詞根的拆法 ma-usa-i 0.3、音變 0.1；虛擬詞根 ma-usay 等 0.1）：虛擬詞根不擠掉 usa；兩種都符合時證據用詞庫詞根', () => {
    // 詞庫拆法本身就是 BCDP 最好的命中（音變 0.1），三種模糊程度都取
    for (const f of FUZZY_LEVELS) expect(tokens('ma-usa', f), f).toContain('mausay')
    const cell = engine.searchPattern('ma-…').hits.flatMap((h) => h.matches.flatMap((m) => m.cells)).find((c) => c.key === 'mausay')
    expect(cell?.evidence).toMatchObject({ term: 'usa', analysis: { stem: 'usa' } })
    expect(/** @type {any} */ (cell?.evidence).analysis.virtual).toBeUndefined()
  })

  it('mupakita（mu-pakita、mu-pa-kita）：pa-… 不中（最外層是 mu-），…-pa-… 中；寫出詞根時也一樣', () => {
    expect(tokens('pa-…')).not.toContain('mupakita')
    expect(tokens('…-pa-…')).toContain('mupakita')
    expect(tokens('pa-kita')).not.toContain('mupakita')
    expect(tokens('…-pa-kita')).toContain('mupakita')
    // 列出的詞綴與詞根之間可以有沒列出的：mu-kita 找到 mu-pa-kita
    expect(tokens('mu-kita')).toContain('mupakita')
  })

  it('證據：符合條件的拆法中成本最低的；不是最好的拆法時附上最好的成本（介面標「次佳」）', () => {
    const cell = (/** @type {string} */ q, /** @type {string} */ token) =>
      engine.searchPattern(q).hits.flatMap((h) => h.matches.flatMap((m) => m.cells)).find((c) => c.key === token)?.evidence
    expect(cell('…-pa-…', 'mupakita')).toMatchObject({ matchType: 'lemma', word: 'mupakita', term: 'kita', analysis: { stem: 'kita', bestCost: 0.1 } })
    expect(/** @type {any} */ (cell('…-pa-…', 'mupakita')).analysis.cost).toBeCloseTo(0.2)
    // 最好的拆法本身符合時，cost 等於 bestCost
    const best = /** @type {any} */ (cell('mu-…', 'mupakita')).analysis
    expect(best.stem).toBe('pakita')
    expect(best.cost).toBeCloseTo(best.bestCost)
    // 有音變的拆法：說明為前幾筆計算（與建置自動派生圖時同一個計算）
    expect(/** @type {any} */ (cell('pa-…', 'bakita')).analysis.notes.length).toBeGreaterThan(0)
    expect(/** @type {any} */ (cell('pa-…', 'paputiuk')).analysis.notes).toEqual([])
  })

  it('W_INNER_AFFIX：pa-… 提示改寫成 …-pa-… 多找到幾個詞形；改寫保留查詢的其他部分，點了得到的就是那些', () => {
    const r = engine.searchPattern('pa-… yaku')
    const hint = r.warnings.find((w) => w.code === 'W_INNER_AFFIX')
    expect(hint).toMatchObject({ start: 0, end: 4, params: { form: 'pa-', query: '…-pa-… yaku' } })
    const more = tokens('…-pa-…').filter((t) => !tokens('pa-…').includes(t))
    expect(more).toEqual(['mupakita'])
    expect(/** @type {any} */ (hint).params.count).toBe(more.length)
    // 已經不錨定、或改寫後多不出詞形時不提示
    expect(engine.searchPattern('…-pa-…').warnings.map((w) => w.code)).not.toContain('W_INNER_AFFIX')
    expect(engine.searchPattern('<in>…').warnings.map((w) => w.code)).not.toContain('W_INNER_AFFIX')
    expect(engine.searchPattern('ta-…-i').warnings.map((w) => w.code)).not.toContain('W_INNER_AFFIX')
  })

  it('詞根是 … 的結果，等於每一個詞根各自寫出來的結果合起來（三種模糊程度；同一個條件，所以一定成立）', () => {
    // 語料中每個詞的所有拆法的詞根（含詞庫外的詞現算的，例如 masay 的虛擬詞根 asay）
    engine.searchPattern('_')
    const pattern = /** @type {any} */ (engine)._pattern
    const roots = [
      ...new Set(
        [...pattern.corpus.docsOf.keys()].flatMap((w) => {
          const id = engine.index.dawg.lookup(w)
          return (id === -1 ? pattern._unlistedParses(w).all : chart.of(id)).map((/** @type {any} */ p) => p.root)
        }),
      ),
    ]
    expect(roots.length).toBeGreaterThan(15)
    expect(roots).toContain('asay')
    const shapes = [(/** @type {string} */ r) => `pa-${r}`, (r) => `mu-${r}`, (r) => `<in>${r}`, (r) => `${r}-en`, (r) => `ta-${r}-i`, (r) => `…-pa-${r}`]
    // 比（記錄、區間），不比詞形：同一個區間由好幾種讀法比到時只算一次，留下的詞形是第一種讀法的，會隨查詢不同
    /** @param {string} q @param {string} f */
    const spans = (q, f) => {
      const r = engine.searchPattern(q, { fuzziness: /** @type {any} */ (f), limit: Infinity })
      expect(r.error, q).toBeNull()
      return [...new Set(r.hits.flatMap((h) => h.matches.filter((m) => m.cond === 0).map((m) => `${h.doc.id}:${m.start}-${m.end}`)))].sort()
    }
    for (const f of FUZZY_LEVELS) {
      for (const shape of shapes) {
        const wild = spans(shape('…'), f)
        const union = [...new Set(roots.flatMap((r) => spans(shape(`"${r}"`), f)))].sort()
        expect(union, `${shape('…')} ${f}`).toEqual(wild)
      }
    }
  })

  it('拆解表可以晚一點接上（網站在第一次需要時才載入 parses.json）', () => {
    const built = buildPatternData()
    const late = new SearchEngine({ ...built, derivations: buildDerivationGraph(built) })
    expect(late.needsParseChart('pa-… ki _')).toBe(true)
    expect(late.needsParseChart('yaku ka _* isiw')).toBe(false)
    expect(late.needsParseChart('@kita')).toBe(false)
    expect(late.needsParseChart('pa-… (')).toBe(false)
    expect(() => late.searchPattern('pa-…')).toThrow(/parses\.json/)
    // 不需要拆解表的查詢照常
    expect(late.searchPattern('yaku ka _* isiw').hits).toHaveLength(4)
    late.attachParseChart(buildParseChart(built))
    expect(late.needsParseChart('pa-… ki _')).toBe(false)
    expect(late.searchPattern('pa-…').hits).toEqual(engine.searchPattern('pa-…').hits)
    // 沒有構詞規格的語言永遠不需要
    expect(buildPatternEngine(null).needsParseChart('pa-…')).toBe(false)
  })
})

describe('與一般搜尋一致', () => {
  /**
   * 詞中有括號的記錄（例句體例 pa(ka)kita）不比：一般搜尋在括號處斷開（pa、ka、kita），句型搜尋依體例讀成 pakakita、pakita。
   * 這個差別本身由下面「詞中的括號」測試固定。
   */
  const INNER_PAREN = /\p{L}\(|\)\p{L}/u
  const sentences = (/** @type {Array<{doc: {text: string, unit: string}}>} */ hits) =>
    [...new Set(hits.filter((h) => h.doc.unit === 'sentence' && !INNER_PAREN.test(h.doc.text)).map((h) => h.doc.text))].sort()
  /** 一般搜尋只留這些方法時找到的句子 @param {string} q @param {string[]} keep */
  const plainSentences = (q, keep) => {
    const r = engine.search(q, { fields: ['native'], exclude: SEARCH_METHODS.filter((m) => !keep.includes(m)) })
    return sentences([...r.entries, ...r.occurrences])
  }

  it.each(['isiw', 'kita', 'hapet', 'mukan'])('%s：等於一般搜尋的完全相符＋相近拼寫', (q) => {
    expect(sentences(engine.searchPattern(q).hits)).toEqual(plainSentences(q, ['exact', 'fuzzy']))
  })

  it.each(['kita', 'kan', 'putiuk'])('@%s：等於一般搜尋的完全相符＋相近拼寫＋自動派生＋確定派生', (q) => {
    expect(sentences(engine.searchPattern(`@${q}`).hits)).toEqual(plainSentences(q, ['exact', 'fuzzy', 'derived', 'dictDerived']))
  })

  it('詞中的括號（刻意的差別）：一般搜尋在括號處斷開，kita 找到 pa(ka)kita；句型搜尋依體例讀成 pakakita、pakita', () => {
    const text = 'yaku pa(ka)kita isiw'
    const plain = engine.search('kita', { fields: ['native'], exclude: SEARCH_METHODS.filter((m) => m !== 'exact') })
    expect([...plain.entries, ...plain.occurrences].map((h) => h.doc.text)).toContain(text)
    expect(engine.searchPattern('"kita"').hits.map((h) => h.doc.text)).not.toContain(text)
    expect(engine.searchPattern('"pakakita"').hits.map((h) => h.doc.text)).toEqual([text])
    expect(engine.searchPattern('"pakita"').hits.map((h) => h.doc.text)).toContain(text)
  })
})

describe('句、讀法、& 與 !、篩選、頻率', () => {
  it('^ $ 以句為單位：「pinakita ki saw. yaku ka isiw」的第二句以 yaku 開頭', () => {
    expect(docs('^ yaku ka')).toContain('pinakita ki saw. yaku ka isiw')
    expect(docs('saw $')).toEqual(expect.arrayContaining(['pinakita ki saw. yaku ka isiw', 'mikita isiw ki saw']))
    // _* 不跨句
    expect(docs('pinakita _* isiw')).toEqual([])
  })

  it('語法書的體例：(ka) 可以省略、iu/*maki 只有 iu', () => {
    expect(docs('yaku mupuza')).toEqual(['yaku (ka) mupuza lia.'])
    expect(docs('yaku ka mupuza')).toEqual(['yaku (ka) mupuza lia.'])
    expect(docs('mama iu iah')).toEqual(['yaku nahaza mama iu/*maki iah.'])
    expect(docs('mama maki')).toEqual([])
  })

  it('& 與 !：同一筆記錄都要有、不能有', () => {
    expect(docs('yaku & isiw & !hapet')).toEqual(expect.not.arrayContaining(['yaku ka hapet isiw']))
    expect(docs('yaku & isiw & !hapet')).toContain('yaku ka maha isiw usa humak.')
    expect(docs('ki !saw')).toEqual(expect.arrayContaining(['paputiuk ki hapuy', 'mineken ki kawas']))
    expect(docs('ki !saw')).not.toContain('mikita isiw ki saw')
  })

  it('分區：詞條（詞綴與詞）、片語、句子；各區依分數排序、各自取前 limit 筆，句子再多也不會擠掉詞條', () => {
    const r = engine.searchPattern('pa-…')
    expect(r.groups.map((g) => g.key)).toEqual(['entries', 'phrases', 'sentences'])
    const entries = r.hits.filter((h) => h.group === 'entries')
    expect(entries.map((h) => h.doc.text)).toEqual(expect.arrayContaining(['pakita', 'pinakita', 'paputiuk', 'pakan', 'barak']))
    expect(entries.every((h) => h.doc.unit === 'word' || h.doc.unit === 'affix')).toBe(true)
    expect(r.hits.filter((h) => h.group === 'sentences').every((h) => h.doc.unit === 'sentence')).toBe(true)
    // 依分區排列：詞條在前
    const order = r.hits.map((h) => ['entries', 'phrases', 'sentences'].indexOf(h.group))
    expect(order).toEqual([...order].sort((x, y) => x - y))
    expect(r.groups.reduce((sum, g) => sum + g.total, 0)).toBe(r.totals.hits)
    expect(r.groups.find((g) => g.key === 'entries')?.total).toBe(entries.length)
    // limit 是每一區的上限，總數不變
    const one = engine.searchPattern('pa-…', { limit: 1 })
    expect(one.hits.filter((h) => h.group === 'entries')).toHaveLength(1)
    expect(one.hits.filter((h) => h.group === 'sentences')).toHaveLength(1)
    expect(one.groups).toEqual(r.groups)
  })

  it('篩選：語言單位', () => {
    expect(docs('mu-…', { filters: { units: ['word'] } }).every((t) => !t.includes(' '))).toBe(true)
  })

  it('候選篩選只是加速：關掉時結果相同', () => {
    for (const q of ['yaku ka _* isiw', 'pa-… ki _', '^ _ ki', '…-i $', 'yaku & !hapet', '@kita', 'ki/ni _', '(yaku|isiw) _{0,2} ki', 'minukan isiw? yaku', '(mineken|takani) ki']) {
      expect(engine.searchPattern(q, { prefilter: false }), q).toMatchObject({ hits: engine.searchPattern(q).hits, totals: engine.searchPattern(q).totals })
    }
  })

  it('頻率：主條件每一格的詞形次數；^ $ 不統計', () => {
    const r = engine.searchPattern('_ ki _ $')
    expect(r.slots.map((s) => s.anchor)).toEqual([false, false, false, true])
    expect(r.frequency.map((f) => f.slot)).toEqual([0, 1, 2])
    expect(r.frequency[1].rows).toEqual([{ form: 'ki', count: r.totals.matches, docs: r.totals.hits }])
    expect(r.frequency[2].rows.map((x) => x.form)).toEqual(expect.arrayContaining(['saw', 'kawas', 'hapuy']))
  })

  it('語詞索引：命中區間左右的詞（由近到遠）', () => {
    const hit = engine.searchPattern('mikita').hits.find((h) => h.doc.text === 'mikita isiw ki saw')
    expect(hit?.matches[0]).toMatchObject({ left: [], right: ['isiw', 'ki', 'saw'] })
  })

  it('語法錯誤：回傳錯誤代碼與位置，不丟出例外', () => {
    expect(engine.searchPattern('yaku (ka')).toMatchObject({ error: { code: 'E_UNCLOSED_PAREN', start: 5 }, hits: [] })
  })
})

it('測試資料的構詞文法沿用 docs/morph-grammar.md 的寫法', () => {
  expect(PATTERN_GRAMMAR.morphemes.find((m) => m.id === 'AF')?.forms).toEqual(['m', 'mu', 'mi', 'me'])
})
