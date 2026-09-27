/**
 * @file 介面字串的鍵：中文原文就是鍵（gettext 的做法）。
 *
 * 程式裡直接寫中文：`t('找不到「{query}」的結果', { query })`。中文介面直接顯示這段文字（代入參數），
 * 其他語系到 `locales/<語系>.json` 查這段中文對應的譯文，查不到就顯示中文。
 *
 * 同一句中文在不同地方要翻成不同的譯文時（例如「詞條」是頁面標題 Entry、也是角色 Headword），
 * 加上語境：`t('詞條', null, '角色')`，譯文檔的鍵寫成「角色|詞條」。
 *
 * 不是在 t() 的呼叫處直接寫出來的字串（例如代碼 → 名稱的對照表），用 `msg('…')` 包起來：
 * 它原樣傳回鍵，作用只是讓 `babizu locales` 與單元測試找得到這些字串。
 */

/** 語境與原文之間的分隔字元（譯文檔的鍵寫成「語境|原文」） */
export const CONTEXT_SEPARATOR = '|'

/**
 * 標出一個介面字串（原樣傳回鍵）。
 * @param {string} text 中文原文
 * @param {string} [context] 語境：同一句中文要有不同譯文時才需要
 * @returns {string}
 */
export function msg(text, context) {
  return context ? `${context}${CONTEXT_SEPARATOR}${text}` : text
}

/**
 * 鍵 → 中文原文（去掉語境）。
 * @param {string} key
 */
export function sourceText(key) {
  const at = key.indexOf(CONTEXT_SEPARATOR)
  return at === -1 ? key : key.slice(at + 1)
}
