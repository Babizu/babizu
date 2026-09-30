/**
 * @file babizu/search：搜尋索引的建置與查詢引擎。
 *
 * - 建置端：`buildSearchIndex` 由標準記錄產生 docs.json、lexicon.json，並附上語言設定檔；
 *   `buildDerivationGraph` 由詞圖產生自動派生圖 derivations.json
 * - 網站端：`SearchEngine` 載入上述檔案並提供搜尋
 * - 共用：`createTextTools(profile)` 產生搜尋鍵、斷詞等文字處理，保證兩端一致
 */

export * from './format.js'
export * from './text.js'
export { buildSearchIndex } from './build.js'
export {
  buildDerivationGraph,
  createDerivationAnalyzer,
  DerivationGraph,
  DERIVATIONS_FORMAT_VERSION,
  encodeDerivations,
  isVirtualRootShape,
  VIRTUAL_ROOT_PENALTY,
} from './derivations.js'
export { SearchEngine, FUZZINESS } from './engine.js'
export { buildEntryGroups, collectHits, computeParents, mergeSpellings, spellingOf } from './family.js'
export { Checklist, classify } from './checklist.js'
