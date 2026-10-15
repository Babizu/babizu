/**
 * @file 實驗性：通用 WFST 參考後端。見 wfst.ts 與 builders.ts 的檔頭。
 *
 * 只供評估與測試使用（`import ... from '@babizu/bcdp/fst'`），網站不會載入。
 */

export { compose, EPS, invert, shortestDistance, stringAcceptor, type Arc, type Wfst } from './wfst.ts'
export { editTransducer, fstLemmaSearch, surfaceLexicon, type SurfaceState } from './builders.ts'
