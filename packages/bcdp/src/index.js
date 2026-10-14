/**
 * @file @babizu/bcdp：跨方言加權編輯距離、詞圖（DAWG）模糊搜尋，與構詞搜尋 BCDP（邊界耦合 DP）。
 * 與語言無關、零執行期依賴；babizu 框架以 `#bcdp` 引用，網站以 `babizu/fuzzy` 取得。
 *
 * 語言的規則以「語言設定檔」（純資料，見 profile.js 與 docs/language-profile.md）提供：
 *
 * ```js
 * import { FuzzyIndex, createMetricFromProfile } from '@babizu/bcdp'
 * import profile from './language.json' with { type: 'json' }
 *
 * const metric = createMetricFromProfile(profile)
 * metric.distance('raulu', 'laulu')          // 0.1（依設定檔中的 r↔l 規則）
 *
 * const index = new FuzzyIndex(metric)
 * index.addAll([['bintun', 1], ['atun', 2], ['alaw', 3]])
 * index.search('bintul', { maxDistance: 0.5 }) // [{ term: 'bintun', distance: 0.1, ... }]
 * ```
 *
 * 也可以不用設定檔，直接組合 RuleSet、CostModel、createNormalizer 建立 WeightedEditDistance。
 */

export { createNormalizer, defaultNormalize, toChars, DEFAULT_CHAR_MAP } from './text-normalize.js'
export { CostModel, DEFAULT_COSTS } from './costs.js'
export { RuleSet } from './rules.js'
export { WeightedEditDistance } from './distance.js'
export { NORMALIZATIONS, resolveNormalization } from './score-normalization.js'
export { Dawg, DAWG_FORMAT, DAWG_VERSION } from './dawg.js'
export { FuzzyIndex, INDEX_FORMAT, INDEX_VERSION } from './fuzzy-index.js'
export { createAffixStripper } from './expanders.js'
export { alternationRules, ALTERNATION_CATEGORY, circumfixStep, createAnalyzer, GLIDE_PATTERNS, REDUPLICATION_PATTERNS, rootCostOf, validateMorphology } from './morphology.js'
export { createMorphSearch } from './morph-search.js'
export { DERIVATION_MAX_COST, isVirtualRootShape, lexicalEdgeCost, soundOf, virtualRootCost, virtualRoots } from './virtual-roots.js'
export { expandGrammar, isGrammarSpec, validateGrammar } from './grammar.js'
export { roundCost, EPSILON } from './dp.js'
export {
  PROFILE_FORMAT,
  PROFILE_VERSION,
  validateProfile,
  assertProfile,
  normalizerOptionsFromProfile,
  notationCharsOf,
  createMetricFromProfile,
  createRulesFromProfile,
  createAlternationMetricFromProfile,
} from './profile.js'
