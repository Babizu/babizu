/**
 * @file 隨機的構詞文法、詞庫與查詢（兩種實作的仲裁測試共用）。
 *
 * 文法涵蓋同位詞素與條件、落在前綴上的中綴（複合前綴）、組合規則（前綴式、詞根上的運算式）、
 * 重疊、構詞音變；詞庫也有沒有元音的詞根（條件讀到詞根結尾仍未決定＝不成立）。
 */

import { createAnalyzer, RuleSet, WeightedEditDistance } from '../../../src/fuzzy/index.js'
import { derive } from '../../../src/fuzzy/grammar/derive.js'
import { normalizeGrammar } from '../../../src/fuzzy/grammar/spec.js'
import { alternationRules } from '../../../src/fuzzy/morphology.js'
import { pick, randomString } from '../helpers.js'

const SPACE = { overrides: { ' ': { substitute: 0.1, delete: 0.1, insert: 0.1 } } }
const VOWELS = ['a', 'i', 'u']
const CONSONANTS = ['b', 'd', 'k', 'n', 't']
const ALPHABET = [...VOWELS, ...CONSONANTS]

/** @param {() => number} random */
export function randomGrammarSetup(random) {
  const rules = new RuleSet()
  for (let k = 0; k < 1 + Math.floor(random() * 2); k++) {
    const source = randomString(random, ALPHABET, 0, 2)
    rules.add(source, randomString(random, ALPHABET, source ? 0 : 1, 2), pick(random, [0.1, 0.2]), { position: pick(random, ['any', 'any', 'initial', 'final']) })
  }
  if (random() < 0.6) rules.add('aa', 'a', 0.1).add('uu', 'u', 0.1)
  if (random() < 0.5) rules.add("'", '', 0.1, { position: 'initial' })
  const cond = (/** @type {string[]} */ options) => (random() < 0.8 ? { when: pick(random, options) } : {})
  /** @type {any[]} */
  const morphemes = [
    {
      id: 'AF',
      type: 'prefix',
      allomorphs: [
        { form: 'm', when: '^V' },
        { form: 'mu', when: '^C+[ua]' },
        { form: 'mi', ...cond(['^C+i', '^Ci']) },
      ].slice(0, 2 + Math.floor(random() * 2)),
    },
    { id: 'P2', type: 'prefix', form: pick(random, ['ka', 'ta', 'pa', 'ki']), ...cond(['^C', '^V', '^[bd]']) },
    // 中綴的基底是「前綴 · 詞根」：落在前綴上時，條件先讀已知的前綴（編譯時就可能決定）
    { id: 'PRF', type: 'infix', form: 'in', ...cond(['^C+[ua]', '^Ci', '^C[ai]']) },
    { id: 'PROG', type: 'infix', form: 'a', ...cond(['^C+[ua]', '^Ci']), ...(random() < 0.3 ? { free: false } : {}) },
    { id: 'IRR', type: 'suffix', form: 'ay' },
    { id: 'PF', type: 'suffix', allomorphs: [{ form: 'an' }, { form: 'un', ...cond(['uC*$', 'u$']) }] },
    { id: 'IMP', type: 'suffix', form: 'i', ...cond(['C$', '[ua]C*$']) },
  ]
  if (random() < 0.6) morphemes.push({ id: 'RED', type: 'reduplication', pattern: pick(random, ['Ca', 'CV']), ...cond(['^C', '^Cu']) })
  const constructions = [
    { id: 'AF.IRR', sequence: ['AF', 'PROG', 'IRR'] },
    { id: 'AF.PRF', sequence: ['AF', 'PRF'] },
    { id: 'PRF.PF', sequence: ['PRF', 'PF'] },
    { id: 'P2.IMP', sequence: ['P2', 'IMP'] },
    ...(morphemes.some((m) => m.id === 'RED') ? [{ id: 'RED.IRR', sequence: ['RED', 'IRR'] }] : []),
  ].filter(() => random() < 0.6)
  const spec = {
    cost: pick(random, [0.2, 0.3]),
    minStem: 2,
    maxSteps: 2,
    lemmaSpread: 100,
    vowels: 'aiu',
    unattestedPenalty: pick(random, [0.1, 0.2]),
    conditionPenalty: pick(random, [0.1, 0.3]),
    morphemes,
    constructions,
    alternations: random() < 0.5 ? [{ underlying: 't', surface: 'd', cost: 0.05 }] : [],
  }
  const metric = new WeightedEditDistance({ rules: rules.clone().addTable(alternationRules(spec)), normalize: (s) => s, costs: SPACE })
  const analyzer = createAnalyzer(spec)
  const syllable = () => pick(random, CONSONANTS) + pick(random, VOWELS) + (random() < 0.3 ? pick(random, CONSONANTS) : '')
  // 也有沒有元音的詞根：條件讀到詞根結尾仍未決定＝不成立（docs/morph-grammar.md 7.1）
  const roots = [
    ...new Set(
      Array.from({ length: 10 }, () => {
        const r = random()
        if (r < 0.1) return randomString(random, CONSONANTS, 2, 3)
        return r < 0.4 ? pick(random, VOWELS) + syllable() : syllable() + syllable()
      }),
    ),
  ]
  return { spec, metric, analyzer, roots, grammar: normalizeGrammar(spec) }
}

/**
 * 由詞根依文法造一個衍生形：一條組合規則或一至兩個自由的詞素（同位詞素隨機挑，條件可能不成立），偶爾加一個改字。
 * @param {() => number} random
 * @param {ReturnType<typeof randomGrammarSetup>} setup
 */
export function randomQuery(random, { grammar, roots }) {
  const root = pick(random, roots)
  /** @type {Array<{id: string, allomorph: number}>} */
  let ops = []
  const op = (/** @type {string} */ id) => ({ id, allomorph: Math.floor(random() * (grammar.byId.get(id)?.allomorphs.length ?? 1)) })
  const r = random()
  const freePrefixes = grammar.morphemes.filter((m) => m.free && m.type === 'prefix')
  const freeInfixes = grammar.morphemes.filter((m) => m.free && m.type === 'infix')
  if (grammar.constructions.length && r < 0.4) ops = pick(random, grammar.constructions).sequence.map(op)
  else if (r < 0.65 && freePrefixes.length && freeInfixes.length) {
    // 落在前綴上的中綴（沒有組合規則、順序敏感）：複合前綴
    ops = [op(pick(random, freePrefixes).id), op(pick(random, freeInfixes).id)]
  } else {
    const free = grammar.morphemes.filter((m) => m.free)
    const first = pick(random, free)
    ops = [op(first.id)]
    if (random() < 0.6) {
      const second = pick(random, free.filter((m) => m.type === 'prefix' || m.type === 'suffix' || (m.type === 'infix' && first.type === 'prefix')))
      if (second && second.id !== first.id) ops.push(op(second.id))
    }
  }
  const d = derive(grammar, root, ops)
  let q = d.valid ? d.surface : root + 'an'
  if (random() < 0.2) {
    const at = Math.floor(random() * q.length)
    q = q.slice(0, at) + pick(random, ALPHABET) + q.slice(at + 1)
  }
  return q
}
