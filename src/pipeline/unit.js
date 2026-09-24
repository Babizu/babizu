/**
 * @file 語言單位（unit）的機械判定規則。
 *
 * 延續《巴宰語詞典》JSON 化規範「機械規則優先於語言學判斷」的原則：
 * 規則只看字形與記錄在來源中的角色，可重現、可批次重算。
 *
 * 判定順序：
 * 1. 構詞類型為黏著形式（bound-initial／bound-final／circumfix／infix），
 *    或字形以 `-` 開頭／結尾、形如 `<x>` → affix
 * 2. 角色是例句或語料句（example／segment）：
 *    以句末標點（. ! ?）結尾，或含 3 個以上的詞 → sentence；2 個詞 → phrase；否則 word
 * 3. 其他角色（詞條、派生詞、清單項目）：含 2 個以上的詞 → phrase；否則 word
 *    （詞表中的「baruzak binayu 野豬」是名詞組，不因詞數多而算句子）
 */

/** 句末標點（允許後面接引號或括號） */
const SENTENCE_END = /[.!?。！？][”"’')）]*$/u

/**
 * @param {string} text
 * @param {{formType?: string | null, role?: string | null}} [context]
 * @returns {'affix' | 'word' | 'phrase' | 'sentence'}
 */
export function classifyUnit(text, { formType = null, role = null } = {}) {
  const t = text.trim()
  if (formType && formType !== 'free') return 'affix'
  if (!formType && (/^-|-$/u.test(t) || /^<[^>]+>$/u.test(t))) return 'affix'

  const wordCount = t.split(/\s+/u).filter(Boolean).length
  if (role === 'example' || role === 'segment') {
    if (SENTENCE_END.test(t) || wordCount >= 3) return 'sentence'
    return wordCount === 2 ? 'phrase' : 'word'
  }
  return wordCount >= 2 ? 'phrase' : 'word'
}
