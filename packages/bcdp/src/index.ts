/**
 * @file @babizu/bcdp：跨方言加權編輯距離、詞圖（DAWG）模糊搜尋，與構詞搜尋 BCDP（邊界耦合 DP）。
 * 與語言無關、零執行期依賴；babizu 框架以 `#bcdp` 引用，網站以 `babizu/fuzzy` 取得。
 *
 * 語言的規則以「語言設定檔」（純資料，見 profile.ts 與 docs/language-profile.md）提供：
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

export { createNormalizer, defaultNormalize, toChars, DEFAULT_CHAR_MAP, type Normalizer, type NormalizerOptions } from './text-normalize.ts'
export { CostModel, DEFAULT_COSTS, type CostOptions } from './costs.ts'
export { RuleSet, type RuleGroup, type RulePosition, type RuleTableRow } from './rules.ts'
export { WeightedEditDistance, type AlignmentStep, type Explanation, type MetricOptions, type PublicRule } from './distance.ts'
export { NORMALIZATIONS, resolveNormalization, type NormalizationStrategy } from './score-normalization.ts'
export { Dawg, DAWG_FORMAT, DAWG_VERSION, type SerializedDawg } from './dawg.ts'
export { FuzzyIndex, INDEX_FORMAT, INDEX_VERSION, type NodeVisit, type SearchOptions, type SearchResult, type SearchStats, type SerializedIndex, type SpreadCutoff } from './fuzzy-index.ts'
export type { JunctionEnd, JunctionState } from './junction.ts'
export {
  alternationRules,
  ALTERNATION_CATEGORY,
  circumfixStep,
  createAnalyzer,
  GLIDE_PATTERNS,
  REDUPLICATION_PATTERNS,
  rootCostOf,
  validateMorphology,
  type Analyzer,
  type AnalyzerSpec,
  type Gloss,
  type MorphologySpec,
  type MorphStep,
  type Part,
  type ReduplicationPattern,
} from './morphology.ts'
export { createMorphSearch, type MorphHit, type MorphSearch, type MorphSearchDeps, type MorphStepHit, type Prepared, type SoundNote } from './morph-search.ts'
export { DERIVATION_MAX_COST, isVirtualRootShape, lexicalEdgeCost, soundOf, virtualRootCost, virtualRoots, type VirtualRoot } from './virtual-roots.ts'
export { expandGrammar, isGrammarSpec, validateGrammar, type GrammarSpec } from './grammar.ts'
export { roundCost, EPSILON } from './dp.ts'
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
  type LanguageProfile,
} from './profile.ts'
