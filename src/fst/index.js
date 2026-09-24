/**
 * @file 實驗性：通用 WFST 參考後端。見 wfst.js 與 builders.js 的檔頭。
 *
 * 只供評估與測試使用（`import ... from 'babizu/fst'`），網站不會載入。
 */

export { compose, EPS, invert, shortestDistance, stringAcceptor } from './wfst.js'
export { editTransducer, fstLemmaSearch, surfaceLexicon } from './builders.js'
