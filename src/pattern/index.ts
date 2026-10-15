/**
 * @file babizu/pattern：句型搜尋（依詞序與構詞搜尋例句，docs/pattern-query.md）。
 *
 * - `looksLikePattern`、`isPatternQuery`：一般搜尋框的查詢要不要以句型搜尋（介面與 Web Worker 共用）
 * - `parsePattern`：剖析（只看寫法）；`findMatches`：比對器（語意與 RegExp 的 g 旗標相同）
 * - 搜尋本身由 `SearchEngine.searchPattern` 執行（PatternSearch）
 */

export { looksLikePattern, isPatternQuery } from './detect.ts'
export { parsePattern } from './parser.ts'
export { findMatches, matchesAnywhere } from './match.ts'
export { segmentText, MAX_READINGS } from './sentences.ts'
export { createPatternMorphology, PARSE_SELECTION, readingOfSteps, satisfies, selectParses, stepMorphs } from './morph.ts'
export {
  PatternSearch,
  PATTERN_GROUPS,
  MAX_MATCHES,
  TIME_BUDGET_MS,
  type PatternCell,
  type PatternEvidence,
  type PatternGroupKey,
  type PatternHit,
  type PatternMatch,
  type PatternResponse,
  type PatternSearchOptions,
} from './search.ts'
export {
  PatternError,
  PATTERN_ERRORS,
  PATTERN_WARNINGS,
  MAX_ATOMS,
  MAX_QUERY_LENGTH,
  MAX_REPEAT,
  type PatternErrorCode,
  type PatternIssue,
  type PatternWarningCode,
} from './errors.ts'
export type * from './ast.ts'
