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
import { alternationRules } from '../../src/fuzzy/morphology.js'
import { createRandom, pick, randomString } from './helpers.js'
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

/** 空白的增刪只算 0.1（與網站相同），讓含空白的查詢有機會對到詞根 */
const SPACE = { overrides: { ' ': { substitute: 0.1, delete: 0.1, insert: 0.1 } } }

/**
 * 距離函式：方言規則加上構詞規格的構詞音變（只在交界適用的規則，與網站相同的組法）。
 * @param {RuleSet} rules
 * @param {any} spec
 * @param {(s: string) => string} [normalize]
 */
function metricFor(rules, spec, normalize = (s) => s) {
  return new WeightedEditDistance({ rules: rules.clone().addTable(alternationRules(spec)), normalize, costs: SPACE })
}

/**
 * 隨機的構詞規格與詞庫。字母表有元音與輔音，讓中綴（首輔音之後）、重疊有意義；
 * 規則有多字元的（可以跨越交界，例如元音合併 aa → a）、詞首詞尾的、喉塞音增生（' → ∅，詞首），
 * 規格有構詞音變 t → d（詞素末）。
 * @param {() => number} random
 */
function randomMorphSetup(random) {
  const vowels = ['a', 'i', 'u']
  const consonants = ['b', 'd', 'k', 'n', 't']
  const alphabet = [...vowels, ...consonants]
  const rules = new RuleSet()
  const ruleCount = 1 + Math.floor(random() * 3)
  for (let k = 0; k < ruleCount; k++) {
    const source = randomString(random, alphabet, 0, 2)
    rules.add(source, randomString(random, alphabet, source ? 0 : 1, 2), pick(random, [0.1, 0.2]), {
      position: pick(random, ['any', 'any', 'initial', 'final']),
    })
  }
  const merge = random() < 0.6
  if (merge) rules.add(pick(random, vowels).repeat(2), '', 0).add('aa', 'a', 0.1).add('uu', 'u', 0.1).add('ii', 'i', 0.1)
  const glottal = random() < 0.7
  if (glottal) rules.add("'", '', 0.1, { position: 'initial' })
  const affixes = (/** @type {number} */ n, /** @type {number} */ max) =>
    [...new Set(Array.from({ length: n }, () => randomString(random, alphabet, 1, max)))].map((form) => ({ form, cost: pick(random, [0.2, 0.3]) }))
  const spec = {
    cost: 0.3,
    minStem: 2,
    maxSteps: 2,
    lemmaSpread: 100,
    vowels: 'aiu',
    // 各兩個詞綴、maxSteps 2：鏈的合併（第 2 層）照樣測到，窮舉的組合數（7 × 7）才不會太多
    prefixes: [...affixes(1, 2), { form: pick(random, ['ta', 'ku', 'ma']) }],
    suffixes: [{ form: pick(random, ['an', ...affixes(1, 2).map((a) => a.form)]) }, { form: pick(random, ['aw', 'i']) }],
    infixes: random() < 0.7 ? [{ form: 'in' }] : [],
    // 一至兩種重疊型式（可能相同，createAnalyzer 照單全收；重複的型式也要與窮舉一致）
    reduplication: random() < 0.8 ? Array.from({ length: 1 + Math.floor(random() * 2) }, () => ({ pattern: pick(random, [...REDUPLICATION_PATTERNS]) })) : [],
    alternations: random() < 0.7 ? [{ underlying: 't', surface: 'd', cost: 0.05 }] : [],
  }
  // 規則 aa → '' 權重 0 只是為了讓 RuleSet 的組合多樣；拿掉以免成本為 0 的刪除讓一切都便宜
  const cleaned = RuleSet.fromTable(rules.toJSON().filter((r) => !(r.target === '' && r.weight === 0)))
  const metric = metricFor(cleaned, spec)
  const analyzer = createAnalyzer(spec)
  // 詞根多半是 CV(C)CV(C) 形狀，讓兩音節的重疊型式（CVCV、CVCVC）有機會適用；也有元音開頭的
  const syllable = () => pick(random, consonants) + pick(random, vowels) + (random() < 0.4 ? pick(random, consonants) : '')
  const roots = [
    ...new Set(
      Array.from({ length: 10 }, () => {
        const r = random()
        if (r < 0.5) return syllable() + syllable()
        if (r < 0.7) return pick(random, vowels) + syllable()
        return randomString(random, consonants, 1, 1) + randomString(random, alphabet, 1, 4)
      }),
    ),
  ]
  return { metric, spec: analyzer.spec, analyzer, roots, alphabet, glottal, merge }
}

/**
 * 由詞根造一個衍生形：隨機加前綴、後綴、中綴、重疊，詞幹末的 t 在後綴前寫成 d；
 * 交界上偶爾合併相同的元音、插入喉塞音；偶爾再加一個隨機改字與空白。
 * @param {() => number} random
 * @param {ReturnType<typeof randomMorphSetup>} setup
 */
function derive(random, { spec, analyzer, roots, alphabet, glottal, merge }) {
  let w = pick(random, roots)
  if (spec.infixes.length && random() < 0.2) {
    const head = analyzer.onset(w)
    w = head + spec.infixes[0].form + w.slice(head.length)
  } else if (spec.reduplication.length && random() < 0.4) {
    const red = analyzer.reduplicant(pick(random, spec.reduplication).pattern, w) ?? ''
    w = red + (glottal && random() < 0.3 && 'aiu'.includes(w[0]) ? "'" : '') + w
  }
  // 詞根以元音結尾時，常挑同一個元音開頭的後綴（元音合併）
  const same = spec.suffixes.find((s) => s.form[0] === w.at(-1))
  const suffix = same && merge && random() < 0.5 ? same.form : random() < 0.6 ? pick(random, spec.suffixes).form : ''
  if (suffix && spec.alternations.length && w.endsWith('t') && random() < 0.6) w = `${w.slice(0, -1)}d`
  const prefix = random() < 0.6 ? pick(random, spec.prefixes).form : ''
  let left = prefix
  let right = suffix
  // 交界上的元音合併與喉塞音增生
  if (merge && left && left.at(-1) === w[0] && random() < 0.8) left = left.slice(0, -1)
  else if (glottal && left && 'aiu'.includes(left.at(-1) ?? '') && 'aiu'.includes(w[0]) && random() < 0.8) left += "'"
  if (merge && right && right[0] === w.at(-1) && random() < 0.8) right = right.slice(1)
  let q = left + w + right
  if (random() < 0.2) {
    const at = Math.floor(random() * q.length)
    q = q.slice(0, at) + pick(random, alphabet) + q.slice(at + 1)
  }
  // 偶爾插入一個空白：多詞查詢、詞素交界在空白旁的情形（bcdp.md 1.6 第 1 項）
  if (random() < 0.1 && q.length > 2) {
    const at = 1 + Math.floor(random() * (q.length - 1))
    q = `${q.slice(0, at)} ${q.slice(at)}`
  }
  return q
}

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
  it.each([1, 2, 3, 4, 5, 6])('種子 %i：每個命中與成本都等於窮舉；說明的對齊加上步驟成本等於命中的成本', { timeout: 60_000 }, (seed) => {
    const random = createRandom(seed * 104729)
    let compared = 0
    for (let round = 0; round < 8; round++) {
      const setup = randomMorphSetup(random)
      const { metric, spec, analyzer, roots } = setup
      const index = new FuzzyIndex(metric).addAll(roots.map((w) => [w, w]))
      const search = createMorphSearch({ analyzer, metric, index })
      const ctx = refJointContext(metric)
      for (let k = 0; k < 8; k++) {
        const query = derive(random, setup)
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
          for (const s of h.steps) if (s.type !== 'prefix' && s.type !== 'suffix') reach(s.pattern ?? s.type)
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
          const detail = `seed=${seed} round=${round} query=${query} term=${t}；參考：${why.get(t) ?? '—'}；規格：${JSON.stringify({ prefixes: spec.prefixes.map((a) => a.form), suffixes: spec.suffixes.map((a) => a.form), infixes: spec.infixes.map((a) => a.form), red: spec.reduplication.map((r) => r.pattern), alt: spec.alternations, rules: metric.ruleSet.expand().map((r) => `${r.source}>${r.target}:${r.position}${r.junction ? ':J' : ''}`) })}`
          expect(got.get(t) ?? Infinity, detail).toBeCloseTo(want.get(t) ?? Infinity, 7)
        }
        compared++
      }
    }
    expect(compared).toBeGreaterThan(35)
  })

  it('reaching check：上面的隨機測試涵蓋每種重疊型式、中綴、構詞音變、跨界規則與交界上的增生', () => {
    for (const kind of [...REDUPLICATION_PATTERNS, 'infix', 'alternation', 'crossing', 'glottal']) {
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
        const query = derive(random, setup)
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
    const setup = fixed({ reduplication: Array.from({ length: 70 }, () => ({ pattern: 'CV' })) })
    const index = new FuzzyIndex(setup.metric).addAll([['kita', 'kita']])
    const search = createMorphSearch({ analyzer: setup.analyzer, metric: setup.metric, index })
    const prepared = /** @type {NonNullable<ReturnType<typeof search.prepare>>} */ (search.prepare('kikita', 1))
    expect(prepared.truncated).toBe(true)
    expect(prepared.variants.filter((v) => v.kind === 'reduplication')).toHaveLength(64)
    expect(() => search.search('kikita', { maxDistance: 1 })).not.toThrow()
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
