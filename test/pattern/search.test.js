/**
 * 句型搜尋（src/pattern/search.js）：
 * - 構詞樣式的寫法與解析（同位詞素組、中綴不看位置、組合的整體寫法、方言寫法、引號）；
 * - 與 BCDP 的對稱：由詞根往下與由詞往上的結果相同（derivations.js 的 reachFrom、ancestors）；
 * - 與一般搜尋的一致：`kita`、`@kita` 找到的記錄與一般搜尋（排除其他搜尋方法）相同；
 * - 句與讀法、& 與 !、候選篩選不影響結果、頻率。
 * 資料是合成的（test/pattern/fixture.js）。
 */

import { describe, expect, it } from 'vitest'
import { SEARCH_METHODS } from '../../src/search/scoring.js'
import { buildPatternEngine, PATTERN_GRAMMAR } from './fixture.js'

const engine = buildPatternEngine()
const graph = /** @type {NonNullable<typeof engine.derivations>} */ (engine.derivations)

/** 句型搜尋，回傳命中的記錄文字 @param {string} q @param {object} [options] */
const docs = (q, options = {}) => {
  const r = engine.searchPattern(q, options)
  if (r.error) throw new Error(`${q}: ${JSON.stringify(r.error)}`)
  return r.hits.map((h) => h.doc.text)
}
/** 命中的詞（主條件的每一格，去重排序） @param {string} q */
const tokens = (q) => {
  const r = engine.searchPattern(q)
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
    expect(en).toEqual(['kitaun', 'midemen'])
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
    expect(tokens('pa-…')).toEqual(['pakan', 'pakita', 'paputiuk', 'pinakita'])
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
    expect(r.warnings).toEqual([expect.objectContaining({ code: 'W_AFFIX_VARIANT', params: { form: 'mo-', to: 'mu-' } })])
    expect(tokens('mo-…')).toEqual(tokens('mu-…'))
    const err = engine.searchPattern('b-…').error
    expect(err).toMatchObject({ code: 'E_UNKNOWN_AFFIX', start: 0, end: 1, params: { form: 'b-', side: 'prefix' } })
    expect(/** @type {any} */ (err).params.suggestions).toContain('pa-')
  })

  it('寫法有歧義時提示：ma- 是靜態 ma-，進行貌的 m<a>- 表面也寫成 ma', () => {
    expect(engine.searchPattern('ma-…').warnings).toEqual([expect.objectContaining({ code: 'W_ALSO_CONSTRUCTION', params: { form: 'ma-', parts: 'm- ＋ <a>' } })])
  })

  it('前綴的順序：子序列；環綴；重疊', () => {
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

describe('與 BCDP 對稱：由詞根往下與由詞往上是同一條路徑', () => {
  it('每個詞的每個詞根：ancestors(w) 中的路徑就是 reachFrom(詞根) 中 w 的那一條；反過來也都找得到', () => {
    let pairs = 0
    engine.index.terms.forEach((_, w) => {
      for (const a of graph.ancestors(w)) {
        expect(graph.reachFrom(a.root).get(w)).toBe(a.reach)
        pairs++
      }
    })
    for (let u = 0; u < graph.nodes.length; u++) {
      for (const w of graph.reachFrom(u).keys()) expect(graph.ancestors(w).some((a) => a.root === u)).toBe(true)
    }
    expect(pairs).toBeGreaterThan(20)
  })

  it('構詞樣式：詞根是 … 的結果，等於每一個詞根各自寫出來的結果合起來', () => {
    const roots = graph.nodes.filter((_, id) => graph.hasChildren(id))
    for (const shape of [(/** @type {string} */ r) => `pa-${r}`, (r) => `mu-${r}`, (r) => `<in>${r}`, (r) => `${r}-en`, (r) => `ta-${r}-i`]) {
      const wild = tokens(shape('…'))
      const union = [...new Set(roots.flatMap((r) => tokens(shape(`"${r}"`))))].sort()
      expect(union, shape('…')).toEqual(wild)
    }
  })
})

describe('與一般搜尋一致', () => {
  const sentences = (/** @type {Array<{doc: {text: string, unit: string}}>} */ hits) => [...new Set(hits.filter((h) => h.doc.unit === 'sentence').map((h) => h.doc.text))].sort()
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
