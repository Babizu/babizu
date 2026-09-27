/**
 * @file 隨機的平面清單構詞規格、詞庫與衍生形（BCDP 與類 pika 剖析器的仲裁測試共用）。
 */

import { createAnalyzer, REDUPLICATION_PATTERNS, RuleSet, WeightedEditDistance } from '../../src/fuzzy/index.js'
import { alternationRules } from '../../src/fuzzy/morphology.js'
import { pick, randomString } from './helpers.js'

/** 空白的增刪只算 0.1（與網站相同），讓含空白的查詢有機會對到詞根 */
export const SPACE = { overrides: { ' ': { substitute: 0.1, delete: 0.1, insert: 0.1 } } }

/**
 * 距離函式：方言規則加上構詞規格的構詞音變（只在交界適用的規則，與網站相同的組法）。
 * @param {RuleSet} rules
 * @param {any} spec
 * @param {(s: string) => string} [normalize]
 */
export function metricFor(rules, spec, normalize = (s) => s) {
  return new WeightedEditDistance({ rules: rules.clone().addTable(alternationRules(spec)), normalize, costs: SPACE })
}

/**
 * 隨機的構詞規格與詞庫。字母表有元音與輔音，讓中綴（首輔音之後）、重疊有意義；
 * 規則有多字元的（可以跨越交界，例如元音合併 aa → a）、詞首詞尾的、喉塞音增生（' → ∅，詞首），
 * 規格有構詞音變 t → d（詞素末）。
 * @param {() => number} random
 */
export function randomMorphSetup(random) {
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
    // 環綴（三種左邊各有機會出現）：成本比兩個詞綴分開算便宜
    circumfixes: [
      ...(random() < 0.6 ? [{ prefix: pick(random, ['ta', 'ka']), suffix: pick(random, ['aw', 'i', 'an']), cost: 0.3 }] : []),
      ...(random() < 0.4 ? [{ infix: 'in', suffix: pick(random, ['an', 'i']), cost: 0.3 }] : []),
      ...(random() < 0.4 ? [{ reduplication: pick(random, ['Ca', 'CV']), suffix: pick(random, ['ay', 'an']), cost: 0.3 }] : []),
    ],
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
export function randomDerived(random, { spec, analyzer, roots, alphabet, glottal, merge }) {
  let w = pick(random, roots)
  // 環綴：緊貼詞幹，外面偶爾再加一個前綴
  if (spec.circumfixes.length && random() < 0.25) {
    const c = pick(random, spec.circumfixes)
    let core = w
    if (c.kind === 'prefix') core = c.left + w
    else if (c.kind === 'infix') {
      const head = analyzer.onset(w)
      core = head + c.left + w.slice(head.length)
    } else core = (analyzer.reduplicant(c.left, w) ?? '') + w
    let right = c.suffix
    // 環綴的後綴前也是交界：構詞音變 t → d、元音合併照樣發生
    if (spec.alternations.length && core.endsWith('t') && random() < 0.7) core = `${core.slice(0, -1)}d`
    if (merge && right[0] === core.at(-1) && random() < 0.7) right = right.slice(1)
    const outer = random() < 0.3 ? pick(random, spec.prefixes).form : ''
    return outer + core + right
  }
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
