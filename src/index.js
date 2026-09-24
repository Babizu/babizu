/**
 * @file babizu：多語言、可溯源的辭典網站框架。
 *
 * 一個辭典網站由三樣東西組成：
 *
 * 1. **站台設定** `babizu.config.js`（用 `defineSite`）——名稱、介面語系、語言變體、搜尋範例…
 * 2. **語言設定檔**（JSON）——這個語言的正規化與跨方言語音對應規則，見 `babizu/fuzzy`
 * 3. **資料集**——標準格式的辭典資料，由轉接器從原始資料匯出，見 `babizu/pipeline`
 *
 * 然後 `npx babizu build` 就會產生可以放在任何靜態主機上的網站。說明文件見 docs/。
 */

export { defineSite } from './site/config.js'
export { defineAdapter } from './pipeline/adapter.js'
