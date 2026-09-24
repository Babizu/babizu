/**
 * @file 瀏覽器端的族語文字工具（搜尋鍵、斷詞），依站台的語言設定檔建立。
 *
 * 用於畫面上的高亮等顯示用途；搜尋本身在 Worker 中進行，用的是和索引一起載入的同一份設定檔。
 */

import { createTextTools } from '@babizu/search/text.js'
import site from 'virtual:babizu/site'

export const { searchKey, tokenize, splitWords } = createTextTools(/** @type {any} */ (site.profile))
