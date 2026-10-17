/**
 * @file 對應組檢索（實驗性）：模型檔格式、成本、去詞綴與搜尋（docs/csr.md）。
 */

export { CSR_DEFAULT_LEVELS, CSR_DEFAULTS, CSR_MODEL_FORMAT, CSR_MODEL_VERSION, validateCsrModel, type CsrLevel, type CsrModel, type CsrParams, type CsrPattern } from './model.ts'
export { createAffixStripper, type CsrAffix, type CsrAnalysis } from './affixes.ts'
export { buildCostTables, createAligner, inventoryOf, segmentEdits, soundClasses, type CsrStep, type Inventory } from './costs.ts'
export { CorrespondenceSearch, type CsrEntry, type CsrFuzziness, type CsrHit } from './search.ts'
