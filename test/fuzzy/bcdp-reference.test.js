/**
 * 以獨立的參考實作（test/fuzzy/reference/）仲裁正式實作。
 *
 * - refDistance：由定義直接寫成的加權編輯距離，不共用 fillRow。先確認它與 metric.distance 逐一相同，
 *   之後就能當作其他測試的仲裁者。
 * - refMorph：窮舉 BCDP 模型的所有分析，每個分析以整個詞的聯合對齊（ref-joint.js）計價（docs/bcdp.md 第 1 節）。
 * - 使用者回報的例子（跨越詞素交界的音變）與過去修正過的錯誤，寫成固定案例。
 */

import { describe, expect, it } from 'vitest'
import { createAnalyzer, createMorphSearch, EPSILON, FuzzyIndex, REDUPLICATION_PATTERNS, roundCost, RuleSet, WeightedEditDistance } from '../../src/fuzzy/index.js'
import { createRandom, pick, randomString } from './helpers.js'
import { metricFor, randomDerived, randomMorphSetup } from './random-morph.js'
import { refContext, refDistance } from './reference/ref-distance.js'
import { refJointContext } from './reference/ref-joint.js'
import { refMorph } from './reference/ref-morph.js'

describe('參考實作：加權編輯距離', () => {
  it('refDistance 與 metric.distance 逐一相同（隨機規則：多字元、空字串、詞首詞尾、單向、空白）', () => {
    const alphabet = ['a', 'b', 'r', 'l', 'n', 'e', ' ']
    for (let seed = 1; seed <= 8; seed++) {
      const random = createRandom(seed * 7919)
      const rules = new RuleSet()
      const count = 1 + Math.floor(random() * 6)
      for (let k = 0; k < count; k++) {
        const source = randomString(random, alphabet.slice(0, 6), 0, 3)
        const target = randomString(random, alphabet.slice(0, 6), source ? 0 : 1, 3)
        rules.add(source, target, pick(random, [0.1, 0.2, 0.3, 0.5]), {
          position: pick(random, ['any', 'any', 'initial', 'final']),
          bidirectional: random() < 0.7,
        })
      }
      const metric = new WeightedEditDistance({ rules, normalize: (s) => s })
      const ctx = refContext(metric)
      for (let k = 0; k < 150; k++) {
        const x = randomString(random, alphabet, 0, 7)
        const y = randomString(random, alphabet, 0, 7)
        expect(roundCost(refDistance(ctx, Array.from(x), Array.from(y))), `seed=${seed} ${JSON.stringify([x, y])}`).toBe(metric.distance(x, y))
      }
    }
  })
})

/**
 * 構詞搜尋的完整流程（與搜尋引擎相同：prepare → 一次走訪 → finish），另外回傳 prepared 供說明用。
 * @param {ReturnType<typeof createMorphSearch>} search
 * @param {FuzzyIndex} index
 * @param {string} query
 * @param {number} maxDistance
 */
function run(search, index, query, maxDistance) {
  const prepared = search.prepare(query, maxDistance)
  if (!prepared) return { prepared, hits: [] }
  return { prepared, hits: search.finish(prepared, index.searchChannels(prepared.channels), maxDistance) }
}

describe('參考實作：BCDP 模型', () => {
  /** reaching check（preparing-tests）：每種非串接步驟、跨界規則、構詞音變、交界上的增生都要真的出現在命中裡 @type {Map<string, number>} */
  const reached = new Map()
  const reach = (/** @type {string} */ kind) => reached.set(kind, (reached.get(kind) ?? 0) + 1)
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('種子 %i：每個命中與成本都等於窮舉；說明的對齊加上步驟成本等於命中的成本', { timeout: 60_000 }, (seed) => {
    const random = createRandom(seed * 104729)
    let compared = 0
    for (let round = 0; round < 8; round++) {
      const setup = randomMorphSetup(random)
      const { metric, spec, analyzer, roots } = setup
      const index = new FuzzyIndex(metric).addAll(roots.map((w) => [w, w]))
      const search = createMorphSearch({ analyzer, metric, index })
      const ctx = refJointContext(metric)
      for (let k = 0; k < 8; k++) {
        const query = randomDerived(random, setup)
        const maxDistance = pick(random, [0.8, 1, 1.2])
        const { prepared, hits } = run(search, index, query, maxDistance)
        // 還原變體超過上限時會被截斷（prepared.truncated），那時不保證與窮舉相同
        if (prepared?.truncated) continue
        expect(search.search(query, { maxDistance })).toEqual(hits)
        for (const h of hits) {
          const p = /** @type {NonNullable<typeof prepared>} */ (prepared)
          // 找回的詞綴鏈正確：整個詞的對齊成本加上步驟成本就是命中的成本
          const e = search.explainHit(p, h).explanation
          const steps = h.steps.reduce((a, s) => a + s.cost, 0)
          expect(roundCost(e.distance + steps), `${query} → ${h.term}：${JSON.stringify(h.steps.map((s) => s.form))}`).toBeCloseTo(h.distance, 7)
          for (const s of h.steps) if (s.type !== 'prefix' && s.type !== 'suffix') reach(s.type === 'circumfix' ? `circumfix:${s.left?.type}` : (s.pattern ?? s.type))
          // 包覆單位的新形狀：外側緊貼前綴（m<a>-）、沒有後綴、要求詞幹元音開頭（ma-）
          const circ = h.analysis.circumfix
          if (circ?.outer) reach('wrap:outer')
          if (circ && !circ.suffix) reach('wrap:no-suffix')
          if (circ?.vowelStem) reach('wrap:vowel-stem')
          for (const note of search.notesOf(p, h)) {
            if (note.category === '構詞音變') reach('alternation')
            if (note.where === 'junction' && note.target === '' && note.source === "'") reach('glottal')
            if (note.where === 'junction' && Array.from(note.target).length >= 2) reach('crossing')
          }
        }
        const got = new Map(hits.map((h) => [h.term, h.distance]))
        /** @type {Map<string, string>} */
        const why = new Map()
        const want = refMorph(ctx, { query, lexicon: roots, spec, maxDistance, why })
        const terms = new Set([...got.keys(), ...want.keys()])
        for (const t of terms) {
          const detail = `seed=${seed} round=${round} query=${query} term=${t}；參考：${why.get(t) ?? '—'}；規格：${JSON.stringify({ prefixes: spec.prefixes.map((a) => a.form), suffixes: spec.suffixes.map((a) => a.form), infixes: spec.infixes.map((a) => a.form), red: spec.reduplication.map((r) => r.pattern), circ: spec.circumfixes.map((c) => `${c.kind}:${c.left}…${c.suffix}`), alt: spec.alternations, rules: metric.ruleSet.expand().map((r) => `${r.source}>${r.target}:${r.position}${r.junction ? ':J' : ''}`) })}`
          expect(got.get(t) ?? Infinity, detail).toBeCloseTo(want.get(t) ?? Infinity, 7)
        }
        compared++
      }
    }
    expect(compared).toBeGreaterThan(35)
  })

  it('reaching check：上面的隨機測試涵蓋每種重疊型式、中綴、構詞音變、跨界規則與交界上的增生', () => {
    for (const kind of [...REDUPLICATION_PATTERNS, 'infix', 'alternation', 'crossing', 'glottal', 'circumfix:prefix', 'circumfix:infix', 'circumfix:reduplication', 'wrap:outer', 'wrap:no-suffix', 'wrap:vowel-stem']) {
      expect(reached.get(kind) ?? 0, `${kind}：${JSON.stringify([...reached])}`).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('explain：實驗室用的說明與搜尋結果一致', () => {
  it.each([1, 2, 3])('種子 %i：explain(q, t).hit 等於 search 對 t 的命中；找不到時有原因；對齊的成本加上步驟等於命中的成本', (seed) => {
    const random = createRandom(seed * 7717)
    let explained = 0
    let found = 0
    for (let round = 0; round < 8; round++) {
      const setup = randomMorphSetup(random)
      const { metric, analyzer, roots } = setup
      const index = new FuzzyIndex(metric).addAll(roots.map((w) => [w, w]))
      const search = createMorphSearch({ analyzer, metric, index })
      for (let k = 0; k < 6; k++) {
        const query = randomDerived(random, setup)
        const maxDistance = pick(random, [0.8, 1, 1.2])
        const hits = search.search(query, { maxDistance })
        for (const term of roots) {
          const e = /** @type {any} */ (search.explain(query, term, { maxDistance }))
          explained++
          expect(structuredClone(e)).toEqual(e) // 可以從 Web Worker 傳回
          if (e.tooShort) continue
          expect(e.hits).toEqual(hits)
          const want = hits.find((h) => h.term === term) ?? null
          expect(e.hit, `${query} → ${term}`).toEqual(want)
          if (want) {
            found++
            expect(e.reason).toBeNull()
            const steps = want.steps.reduce((a, s) => a + s.cost, 0)
            expect(e.alignment.distance + steps).toBeCloseTo(want.distance, 9)
          } else {
            expect(e.reason, `${query} → ${term}`).toMatch(/^(same|short|bound|spread)$/)
          }
        }
      }
    }
    expect(explained).toBeGreaterThan(300)
    expect(found).toBeGreaterThan(20)
  })
})

describe('固定案例', () => {
  /** 與網站相同的空白處理：連續空白合併、去掉頭尾空白（createNormalizer 的 collapseWhitespace） */
  const collapse = (/** @type {string} */ s) => s.replace(/\s+/gu, ' ').trim()
  /** 固定的小規格：prefix mu-、suffix -an */
  const fixed = (/** @type {any} */ extra = {}, /** @type {RuleSet} */ rules = new RuleSet(), normalize = (/** @type {string} */ s) => s) => {
    const spec = { minStem: 2, maxSteps: 2, lemmaSpread: 100, vowels: 'aiu', prefixes: [{ form: 'mu' }], suffixes: [{ form: 'an' }], ...extra }
    const metric = metricFor(rules, spec, normalize)
    const analyzer = createAnalyzer(spec)
    return { metric, analyzer, spec: analyzer.spec }
  }
  /** @param {ReturnType<typeof fixed>} setup @param {string[]} lexicon @param {string} query */
  const compare = ({ metric, analyzer, spec }, lexicon, query, maxDistance = 1) => {
    const index = new FuzzyIndex(metric).addAll(lexicon.map((w) => [w, w]))
    const hits = createMorphSearch({ analyzer, metric, index }).search(query, { maxDistance })
    const got = new Map(hits.map((h) => [h.term, h.distance]))
    const want = refMorph(refJointContext(metric), { query, lexicon, spec, maxDistance })
    return { got, want, hits }
  }

  it('環綴一定要接它的後綴：只有環綴 ka-…-aw、<in>…-aw 時，ka-kitaaw 的詞根是 kita 而不是 kitaaw（ka- 不接後綴）', () => {
    const circ = fixed({ circumfixes: [{ prefix: 'ka', suffix: 'aw' }, { infix: 'in', suffix: 'aw' }] })
    // 詞庫同時有 kita 與 kitaaw：查詢的結尾正好是後綴，詞根卻可以把後綴吞進去——這時只有接了後綴的分析成立
    const lexicon = ['kita', 'kitaaw', 'baket', 'baketaw']
    for (const [query, yes, no] of [
      ['kakitaaw', 'kita', 'kitaaw'],
      ['binaketaw', 'baket', 'baketaw'],
    ]) {
      const { got, want } = compare(circ, lexicon, query)
      expect(got.has(yes), query).toBe(true)
      expect(got.has(no), query).toBe(false)
      expect(got).toEqual(want)
    }
  })

  describe('使用者回報的例子：音變跨越詞素交界（docs/bcdp.md 1.3）', () => {
    // 與網站的規格同樣的形狀：方言規則「元音」aa → a、「喉塞音」' ↔ ∅（詞首），構詞音變 t → d（詞素末）
    const rules = new RuleSet().add('aa', 'a', 0.1).add('uu', 'u', 0.1).add("'", '', 0.1, { position: 'initial' }).add('l', 'n', 0.1, { position: 'final' })
    const spec = {
      prefixes: [{ form: 'ta' }, { form: 'tau' }, { form: 'ku' }, { form: 'pu' }, { form: 'maxa' }],
      suffixes: [{ form: 'aw' }, { form: 'an' }, { form: 'ay' }],
      reduplication: [{ pattern: 'CVCV' }],
      alternations: [{ underlying: 't', surface: 'd', cost: 0.05 }],
    }
    it.each(/** @type {Array<[string, string, string[], number]>} */ ([
      ['tadusaw', 'dusa', ['ta', 'aw'], 0.7], // ta-dusa-aw：詞幹｜後綴交界的 aa → a
      ['takitaw', 'kita', ['ta', 'aw'], 0.7],
      ['kula', 'ula', ['ku'], 0.4], // ku-ula：前綴｜詞幹交界的 uu → u
      ['maxapux', 'apux', ['maxa'], 0.4],
      ["tau'alawan", 'alaw', ['tau', 'an'], 0.7], // 交界上的喉塞音：詞首規則 ' → ∅ 在交界適用
      ["ali'ali", 'ali', ['ali'], 0.4], // 重疊部分｜詞幹之間的喉塞音
      ['pukabadan', 'kabat', ['pu', 'an'], 0.65], // 構詞音變 t → d（0.05）
      ['babulay', 'babun', ['ay'], 0.4], // 詞尾規則 l → n 在詞幹｜後綴交界適用
    ]))('%s → %s', (query, stem, forms, cost) => {
      const setup = fixed(spec, rules)
      const { got, want, hits } = compare(setup, [stem, 'saw', 'lawan'], query)
      expect(want.get(stem)).toBeCloseTo(cost, 9)
      expect(got.get(stem)).toBeCloseTo(cost, 9)
      expect(hits.find((h) => h.term === stem)?.steps.map((s) => s.form)).toEqual(forms)
    })

    it('構詞音變只在交界適用：沒有詞綴時 t → d 不成立', () => {
      const setup = fixed({ ...spec, suffixes: [{ form: 'an' }] }, new RuleSet())
      expect(setup.metric.distance('kabad', 'kabat')).toBe(1.5) // 普通距離沒有交界
      expect(compare(setup, ['kabat'], 'kabadan').got.get('kabat')).toBeCloseTo(0.35, 9)
    })
  })

  it('多詞查詢：構詞不跨越詞邊界（前綴與詞幹之間不能是空白）', () => {
    // 「mu daux」是兩個詞：交界不能在空白旁，詞綴也不能消耗空白
    const { got, want } = compare(fixed({}, new RuleSet(), collapse), ['daux'], 'mu daux')
    expect(want.has('daux')).toBe(false)
    expect(got.has('daux')).toBe(false)
    // 同一個詞之內照常：mudaux → mu- ＋ daux
    expect(compare(fixed({}, new RuleSet(), collapse), ['daux'], 'mudaux').got.get('daux')).toBeCloseTo(0.3, 9)
  })

  it('多詞查詢：詞幹本身可以含空白（複合詞），交界不在空白旁即可', () => {
    const { got, want } = compare(fixed({}, new RuleSet(), collapse), ['kan dalum'], 'mukan dalum')
    expect(want.get('kan dalum')).toBeCloseTo(0.3, 9)
    expect(got.get('kan dalum')).toBeCloseTo(0.3, 9)
  })

  it('多詞查詢：詞綴不能包含空白', () => {
    const { got, want } = compare(fixed({ suffixes: [{ form: 'an' }, { form: 'nan' }] }, new RuleSet(), collapse), ['dauxa'], 'dauxan an')
    expect(got.get('dauxa') ?? Infinity).toBeCloseTo(want.get('dauxa') ?? Infinity, 9)
  })

  it('非 BMP 字元', () => {
    const { got, want } = compare(fixed(), ['b𝔞d'], 'mub𝔞d')
    expect(want.get('b𝔞d')).toBeCloseTo(0.3, 9)
    expect(got.get('b𝔞d')).toBeCloseTo(0.3, 9)
  })

  it('還原變體多（20 個）時照樣正確', () => {
    const setup = fixed({ reduplication: Array.from({ length: 20 }, () => ({ pattern: 'CV' })) })
    const { got, want } = compare(setup, ['kita'], 'kikita')
    expect(want.get('kita')).toBeCloseTo(0.3, 9)
    expect(got.get('kita')).toBeCloseTo(0.3, 9)
  })

  it('最大測試：還原變體超過上限 64 時標記 truncated，保留前面的變體，不會當掉', () => {
    // 很多個前綴鏈的終點（ki- 重複）× 每種重疊型式與長度：拿法不同的變體超過 64 個
    const setup = fixed({ maxSteps: 10, prefixes: [{ form: 'ki' }], reduplication: REDUPLICATION_PATTERNS.map((pattern) => ({ pattern })) })
    const index = new FuzzyIndex(setup.metric).addAll([['kita', 'kita']])
    const search = createMorphSearch({ analyzer: setup.analyzer, metric: setup.metric, index })
    const query = `${'ki'.repeat(12)}ta`
    const prepared = /** @type {NonNullable<ReturnType<typeof search.prepare>>} */ (search.prepare(query, 3))
    expect(prepared.truncated).toBe(true)
    expect(prepared.variants.filter((v) => v.kind === 'reduplication' || v.kind === 'infix')).toHaveLength(64)
    expect(() => search.search(query, { maxDistance: 3 })).not.toThrow()
  })

  it('同一種拿法的步驟共用一個通道：重複的重疊型式不會增加通道', () => {
    const setup = fixed({ reduplication: Array.from({ length: 70 }, () => ({ pattern: 'CV' })) })
    const index = new FuzzyIndex(setup.metric).addAll([['kita', 'kita']])
    const search = createMorphSearch({ analyzer: setup.analyzer, metric: setup.metric, index })
    const prepared = /** @type {NonNullable<ReturnType<typeof search.prepare>>} */ (search.prepare('kikita', 1))
    expect(prepared.truncated).toBe(false)
    expect(prepared.variants.filter((v) => v.kind === 'reduplication')).toHaveLength(1)
    expect(search.search('kikita', { maxDistance: 1 }).map((h) => [h.term, h.distance])).toEqual([['kita', 0.3]])
  })

  it('查詢不比 minStem 長時不做構詞搜尋', () => {
    const setup = fixed({ prefixes: [{ form: 'b' }] }, new RuleSet().add('a', 'ab', 0.1))
    const { got, want } = compare(setup, ['ab'], 'ba')
    expect(want.size).toBe(0)
    expect(got.size).toBe(0)
  })

  it('lemmaSpread：只保留成本在「最佳 ＋ lemmaSpread」之內的詞根', () => {
    // mudaux：daux ＝ mu- ＋ daux（0.3），udaux ＝ m- ＋ udaux（m- 的成本 0.9）。兩者相差 0.6
    const extra = { prefixes: [{ form: 'mu' }, { form: 'm', cost: 0.9 }] }
    const hitsOf = (/** @type {number} */ lemmaSpread) => {
      const setup = fixed({ ...extra, lemmaSpread })
      const index = new FuzzyIndex(setup.metric).addAll([['daux', 'daux'], ['udaux', 'udaux']])
      return createMorphSearch({ analyzer: setup.analyzer, metric: setup.metric, index }).search('mudaux', { maxDistance: 2 }).map((h) => [h.term, h.distance])
    }
    expect(hitsOf(100)).toEqual([['daux', 0.3], ['udaux', 0.9]])
    expect(hitsOf(0.6)).toEqual([['daux', 0.3], ['udaux', 0.9]]) // 截斷線含等號
    expect(hitsOf(0.5)).toEqual([['daux', 0.3]])
  })

  it('同分：取詞綴較少的鏈（先合併的層）', () => {
    // ma-（0.3）與 m- ＋ a-（各 0.15）都是 0.3：說明取一個前綴的 ma-
    const setup = fixed({ prefixes: [{ form: 'm', cost: 0.15 }, { form: 'a', cost: 0.15 }, { form: 'ma' }] })
    const { hits } = compare(setup, ['daux'], 'madaux')
    expect(hits[0].distance).toBeCloseTo(0.3, 9)
    expect(hits[0].steps.map((s) => s.form)).toEqual(['ma'])
  })

  it('完整重疊後面接後綴：詞幹只有重疊部分那一段', () => {
    const setup = fixed({ reduplication: [{ pattern: 'full' }] })
    const { got, want } = compare(setup, ['dak'], 'dakdakan')
    expect(want.get('dak')).toBeCloseTo(0.6, 9)
    expect(got.get('dak')).toBeCloseTo(0.6, 9)
  })

  it('交界狀態不能是負數（剪枝的下界依賴這一點）', () => {
    const metric = new WeightedEditDistance({ normalize: (s) => s })
    const index = new FuzzyIndex(metric).addAll([['ab', 'ab']])
    expect(() => index.searchChannels([{ query: ['a', 'b'], options: { start: [0, -0.1, Infinity], end: [Infinity, Infinity, 0] } }])).toThrow(/非負/)
    expect(() => index.searchChannels([{ query: ['a', 'b'], options: { end: [Infinity, NaN, 0] } }])).toThrow(/非負/)
  })

  it('重疊部分可以超過 4 個字元（Ca：首輔音群 4 個字元＋a）', () => {
    const setup = fixed({ reduplication: [{ pattern: 'Ca' }] })
    const { got, want } = compare(setup, ['bdknaku'], 'bdknabdknaku')
    expect(want.get('bdknaku')).toBeCloseTo(0.3, 9)
    expect(got.get('bdknaku')).toBeCloseTo(0.3, 9)
  })

  // 各重疊型式各一例。查詢都是公開資料集中的詞，型式的歸類依 Li & Tsuchida (2001) p. 22、
  // Lim & Zeitoun (2024) §51.3.2.2（見 bcdp.md 1.6）
  it.each(/** @type {Array<[string, string, string, number]>} */ ([
    ['Ca', 'dius', 'dadius', 0.3],
    ['CV', 'kiliw', 'kikiliw', 0.3],
    ['CVV', 'depex', 'deedepex', 0.3],
    ['CVV', 'kita', 'kiikita', 0.3],
    ['CVCV', 'lubahing', 'lubalubahing', 0.3],
    ['CVCV', 'kudung', 'maakudukudung', 0.6], // 巴宰語：兩音節去韻尾（maa- ＋ 重疊）
    ['CVCVC', 'kudung', 'maakudungkudung', 0.6], // 噶哈巫語：兩音節含韻尾
    ['full', 'saw', 'sawsaw', 0.3], // 單音節詞根的完整重疊
  ]))('重疊型式 %s：%s ← %s', (pattern, stem, query, cost) => {
    const setup = fixed({ vowels: 'aeiu', prefixes: [{ form: 'mu' }, { form: 'maa' }], suffixes: [{ form: 'an' }, { form: 'i' }], reduplication: [{ pattern }] })
    const { got, want } = compare(setup, [stem], query)
    expect(want.get(stem)).toBeCloseTo(cost, 9)
    expect(got.get(stem)).toBeCloseTo(cost, 9)
  })

  it('重疊複製查詢（方言）的形式：重疊部分跟著查詢，詞幹再以方言規則對應', () => {
    // kipu~kipud-i：只用 CVCV 與方言規則 t↔d（0.1）時，重疊部分 kipu 由查詢的詞幹 kipud 產生，
    // kipud 再以 0.1 對應到 kiput：0.3 ＋ 0.1 ＋ 0.3
    const setup = fixed({ suffixes: [{ form: 'i' }], reduplication: [{ pattern: 'CVCV' }] }, new RuleSet().add('t', 'd', 0.1))
    const { got, want } = compare(setup, ['kiput'], 'kipukipudi')
    expect(want.get('kiput')).toBeCloseTo(0.7, 9)
    expect(got.get('kiput')).toBeCloseTo(0.7, 9)
  })

  it('重疊的模板只套用在詞幹上，不含後綴', () => {
    // kanakanan：若把模板套用在「詞幹＋後綴」kanan 上，CVCV 得到 kana，會誤分析成 kana~kan-an。
    // 詞幹 kan 只有一個音節，CVCV 不適用，所以不是 kan 的重疊
    const setup = fixed({ reduplication: [{ pattern: 'CVCV' }] })
    const { got, want } = compare(setup, ['kan'], 'kanakanan')
    expect(want.has('kan')).toBe(false)
    expect(got.has('kan')).toBe(false)
    expect(compare(setup, ['kanan'], 'kanakanan').got.get('kanan')).toBeCloseTo(0.3, 9)
  })
})

describe('多通道走訪（searchChannels）', () => {
  /** @param {number} seed @param {number} channels */
  function channelCase(seed, channels) {
    const random = createRandom(seed)
    const alphabet = ['a', 'b', 'd', 'n', 'u', ' ']
    const rules = new RuleSet().add('d', 'n', 0.1).add('au', 'o', 0.1).add('b', '', 0.2, { position: 'initial' })
    const metric = new WeightedEditDistance({ rules, normalize: (s) => s })
    const words = [...new Set(Array.from({ length: 40 }, () => randomString(random, alphabet.slice(0, 5), 1, 6)))]
    const index = new FuzzyIndex(metric).addAll(words.map((w) => [w, w]))
    const specs = Array.from({ length: channels }, () => {
      const query = randomString(random, alphabet, 1, 6)
      const n = Array.from(query).length
      /** @type {import('../../src/fuzzy/fuzzy-index.js').SearchOptions} */
      const options = { maxDistance: pick(random, [0.3, 0.8, 1.5]) }
      if (random() < 0.5) {
        options.start = Array.from({ length: n + 1 }, (_, i) => (i === 0 || random() < 0.3 ? pick(random, [0, 0.1, 0.3]) : Infinity))
        options.end = Array.from({ length: n + 1 }, (_, i) => (i === n || random() < 0.3 ? pick(random, [0, 0.2]) : Infinity))
      }
      return { query, options }
    })
    const sorted = (/** @type {any[]} */ rs) => rs.map((r) => [r.term, r.distance, r.endAt ?? null]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    const together = index.searchChannels(specs)
    specs.forEach((s, c) => {
      const alone = index.searchChannels([s])[0]
      expect(sorted(together[c]), `seed=${seed} channel=${c} query=${s.query}`).toEqual(sorted(alone))
    })
  }

  it('N 個通道一起走訪＝各自單獨搜尋（含交界狀態）', () => {
    for (let seed = 1; seed <= 20; seed++) channelCase(seed * 31, 2 + (seed % 9))
  })

  it('超過 31 個通道也能一起走訪', () => {
    channelCase(4242, 40)
  })
})

// EPSILON 保留給之後的容忍比較
void EPSILON
