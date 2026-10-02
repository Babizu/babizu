/**
 * @file babizu/pattern：句型搜尋（依詞序與構詞搜尋例句，docs/pattern-query.md）。
 *
 * - `looksLikePattern`、`isPatternQuery`：一般搜尋框的查詢要不要以句型搜尋（介面與 Web Worker 共用）
 * - `parsePattern`：剖析（只看寫法）；`findMatches`：比對器（語意與 RegExp 的 g 旗標相同）
 * - 搜尋本身由 `SearchEngine.searchPattern` 執行（PatternSearch）
 */

export { looksLikePattern, isPatternQuery } from './detect.js'
export { parsePattern } from './parser.js'
export { findMatches, matchesAnywhere } from './match.js'
export { segmentText, MAX_READINGS } from './sentences.js'
export { createPatternMorphology, readingOfPath, satisfies, stepMorphs } from './morph.js'
export { PatternSearch, MAX_MATCHES, TIME_BUDGET_MS } from './search.js'
export { PatternError, PATTERN_ERRORS, PATTERN_WARNINGS, MAX_ATOMS, MAX_QUERY_LENGTH, MAX_REPEAT } from './errors.js'
