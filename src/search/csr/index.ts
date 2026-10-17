/**
 * @file 對應組檢索（實驗性）：模型檔格式、成本、去詞綴、搜尋與學習（docs/csr.md）。
 */

export {
  CSR_DEFAULT_LEVELS,
  CSR_DEFAULTS,
  CSR_MODEL_FORMAT,
  CSR_MODEL_VERSION,
  isContextPattern,
  occurrenceKey,
  validateCsrModel,
  type CsrLevel,
  type CsrModel,
  type CsrParams,
  type CsrPattern,
} from './model.ts'
export { createAffixStripper, type CsrAffix, type CsrAnalysis } from './affixes.ts'
export {
  buildContextTables,
  buildCostTables,
  contextMatches,
  createAligner,
  inventoryOf,
  soundClasses,
  type AlignSide,
  type ContextTable,
  type ContextUnit,
  type CsrStep,
  type Inventory,
} from './costs.ts'
export { learnCorrespondences, sukhotinVowels, type CsrAlignedPair, type CsrLearned, type CsrLearnedUnit, type CsrLearnOptions } from './learn.ts'
export { CorrespondenceSearch, type CsrEntry, type CsrFuzziness, type CsrHit } from './search.ts'
