/**
 * @file babizu/search：搜尋索引的建置與查詢引擎。
 *
 * - 建置端：`buildSearchIndex` 由標準記錄產生 docs.json、lexicon.json，並附上語言設定檔；
 *   `buildDerivationGraph` 由詞圖產生自動派生圖 derivations.json，`buildParseChart` 產生拆解表 parses.json
 * - 網站端：`SearchEngine` 載入上述檔案並提供搜尋；`engine.terms`（TermMatcher）是一個查詢詞的所有命中，
 *   評估工具與句型搜尋也用它
 * - 共用：`createTextTools(profile)` 產生搜尋鍵、斷詞等文字處理，保證兩端一致
 */

export * from './format.ts'
export * from './text.ts'
export { buildSearchIndex, type BuiltSearchIndex } from './build.ts'
export {
  buildDerivationGraph,
  createDerivationAnalyzer,
  createVirtualRootSearch,
  DerivationGraph,
  DERIVATIONS_FORMAT_VERSION,
  encodeDerivations,
  isVirtualRootShape,
  virtualRootCost,
  virtualRoots,
} from './derivations.ts'
export { buildParseChart, encodeParses, ParseChart, PARSES_FORMAT_VERSION, parsedAnalysis, sortParses, type ParsedAnalysis } from './parses.ts'
export { SearchEngine, type SearchEngineData } from './engine.ts'
export { FUZZINESS, fuzzyOptions, LEMMA_EXTRA_DISTANCE, LEMMA_MAX_DISTANCE, lemmaMax, levelOf } from './fuzziness.ts'
export type { DerivationStart, TermMatcher, WalkStats } from './term-matcher.ts'
export type { DerivedTerms } from './derived-terms.ts'
export type { DictionaryRelation, DictionaryRelations, DictionaryToken } from './dictionary-relations.ts'
export type * from './types.ts'
export { buildEntryGroups, collectHits, computeParents, mergeSpellings, spellingOf, type EntryGroup, type EntryNode, type SpellingMember, type SpellingSet } from './family.ts'
export { Checklist, classify, SEGMENTATION_FILTERS, type DuplicateGroup, type GroupPageOptions, type SegmentationFilter, type TokenKind, type UntreatedToken } from './checklist.ts'
export { collectSegmentations, compareSegmentations, parseSegmentation, SEGMENTATIONS_FORMAT_VERSION, type SegmentationData } from './segmentation.ts'
export { MATCH_TYPES, SEARCH_METHODS, SEARCH_METHOD_GROUPS, type MatchType, type SearchMethod, type SearchMethodGroup } from './scoring.ts'
export * from './csr/index.ts'
