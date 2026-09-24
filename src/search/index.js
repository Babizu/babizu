/**
 * @file babizu/search：搜尋索引的建置與查詢引擎。
 *
 * - 建置端：`buildSearchIndex` 由標準記錄產生 docs.json、lexicon.json，並附上語言設定檔
 * - 網站端：`SearchEngine` 載入上述檔案並提供搜尋
 * - 共用：`createTextTools(profile)` 產生搜尋鍵、斷詞等文字處理，保證兩端一致
 */

export * from './format.js'
export * from './text.js'
export { buildSearchIndex } from './build.js'
export { SearchEngine, FUZZINESS } from './engine.js'
