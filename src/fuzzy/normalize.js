/**
 * @file 字串正規化。
 *
 * 所有距離計算都以「正規化後的 Unicode code point」為單位。查詢字串、詞庫字串、
 * 規則字串都必須經過同一個 normalizer，否則同一個字的不同編碼（例如 NFC 的 `é`
 * 與 NFD 的 `e + ◌́`）會被當成不同字元，距離就會算錯。
 */

/**
 * 巴宰–噶哈巫語資料中常見、應視為同一字元的對映。
 * - 各種撇號統一為 ASCII `'`（喉塞音）
 * - `ǝ`（U+01DD，turned e）統一為 `ə`（U+0259，schwa）：噶哈巫語分類辭典用前者，規則表用後者
 * - 不斷行空白統一為一般空白
 * @type {Readonly<Record<string, string>>}
 */
export const DEFAULT_CHAR_MAP = Object.freeze({
  '’': "'", // ’
  '‘': "'", // ‘
  'ʼ': "'", // ʼ
  '`': "'", // `
  '´': "'", // ´（單獨的尖音符，常被當撇號誤用）
  'ǝ': 'ə', // ǝ → ə
  ' ': ' ',
  '　': ' ',
})

/**
 * @typedef {object} NormalizerOptions
 * @property {boolean} [lowercase=true] 轉小寫
 * @property {Record<string, string>} [charMap=DEFAULT_CHAR_MAP] 逐字元對映（在 NFC 之後套用）
 * @property {boolean} [stripDiacritics=false] 去除附加符號（例如 Reed 詞表的 `ā`、`ū́`）
 * @property {string[]} [preserve=['é']] 去附加符號時仍保留的「合成字元」（噶哈巫語的 `é` 是獨立音位）
 * @property {string} [removeChars=''] 直接刪除的字元集合（例如 `'-<>…'`）
 * @property {boolean} [collapseWhitespace=true] 連續空白壓成一個，並去除頭尾空白
 */

/**
 * 建立一個正規化函式。
 *
 * 處理順序：NFC → 小寫 → 字元對映 → （可選）去附加符號 → （可選）刪除指定字元 → 空白整理 → NFC。
 *
 * @param {NormalizerOptions} [options]
 * @returns {(text: string) => string}
 *
 * @example
 * const normalize = createNormalizer({ stripDiacritics: true })
 * normalize('Tūhūbū́ss') // → 'tuhubuss'
 * normalize('akhéhan') // → 'akhéhan'（é 保留）
 */
export function createNormalizer(options = {}) {
  const {
    lowercase = true,
    charMap = DEFAULT_CHAR_MAP,
    stripDiacritics = false,
    preserve = ['é'],
    removeChars = '',
    collapseWhitespace = true,
  } = options

  const preserved = new Set(preserve.map((ch) => ch.normalize('NFC')))
  const removed = new Set(Array.from(removeChars))
  const mapEntries = Object.entries(charMap)

  return function normalize(text) {
    let s = String(text ?? '').normalize('NFC')
    if (lowercase) s = s.toLowerCase()
    for (const [from, to] of mapEntries) {
      if (s.includes(from)) s = s.split(from).join(to)
    }
    if (stripDiacritics) s = removeMarks(s, preserved)
    if (removed.size > 0) {
      s = Array.from(s)
        .filter((ch) => !removed.has(ch))
        .join('')
    }
    if (collapseWhitespace) s = s.replace(/\s+/gu, ' ').trim()
    return s.normalize('NFC')
  }
}

/**
 * 去除附加符號，但保留 `preserved` 中的合成字元。
 * 做法：逐一檢查 NFC 字元，不在保留清單的就拆成 NFD 並丟掉所有組合記號（\p{M}）。
 * @param {string} s 已 NFC 的字串
 * @param {Set<string>} preserved
 */
function removeMarks(s, preserved) {
  let out = ''
  for (const ch of s) {
    if (preserved.has(ch)) {
      out += ch
    } else {
      out += ch.normalize('NFD').replace(/\p{M}/gu, '')
    }
  }
  return out
}

/**
 * 把字串拆成 code point 陣列（處理 BMP 以外字元時不會被切成半個代理對）。
 * @param {string} s
 * @returns {string[]}
 */
export function toChars(s) {
  return Array.from(s)
}

/** 預設的正規化函式：NFC + 小寫 + 字元對映 + 空白整理，不去附加符號。 */
export const defaultNormalize = createNormalizer()
