/**
 * @file 搜尋用的文字處理：族語搜尋鍵、斷詞、釋義斷詞、語言偵測。
 *
 * 建置端建索引與網站端處理查詢都必須用這裡的函式，而且用**同一份語言設定檔**，兩邊才會一致。
 *
 * - 與語言有關的函式（搜尋鍵、斷詞、距離函式）由 `createTextTools(profile)` 產生。
 * - 與語言無關的函式（釋義斷詞、中文正規化、語言偵測）直接匯出。
 */

import {
  createMetricFromProfile,
  createNormalizer,
  normalizerOptionsFromProfile,
  notationCharsOf,
} from '../fuzzy/index.js'

/** 斷詞用的分隔字元：空白與中英文標點（保留撇號 ' 作為喉塞音） */
const TOKEN_SEPARATORS = /[\s,.;:!?"“”«»()[\]{}/\\|。，、；：！？「」『』（）［］]+/u

/** 詞內的構詞分界（連字號、等號、重疊號、中綴括號） */
const MORPHEME_SEPARATORS = /[-=~<>]+/u

/**
 * @typedef {object} TextTools
 * @property {string} notationChars 搜尋時忽略的體例符號
 * @property {(text: string) => string} baseNormalize 基本正規化（保留體例符號）
 * @property {(text: string) => string} searchKey 族語搜尋鍵
 * @property {(text: string) => string[]} tokenize 族語斷詞（含構詞部分）
 * @property {(text: string) => string[]} splitWords 只切整詞
 * @property {() => import('../fuzzy/distance.js').WeightedEditDistance} createSearchMetric
 */

/**
 * 依語言設定檔建立文字工具。
 * @param {import('../fuzzy/profile.js').LanguageProfile} profile
 * @returns {TextTools}
 *
 * @example
 * const { searchKey, tokenize } = createTextTools(profile)
 * searchKey('Ma-dés')   // → 'madés'（體例符號 - 被忽略；é 依設定保留）
 * tokenize('imini ka kaidi tshay=a akhéhan?')
 * // → ['imini', 'ka', 'kaidi', 'tshaya', 'tshay', 'akhéhan']
 */
export function createTextTools(profile) {
  const normalizerOptions = normalizerOptionsFromProfile(profile)
  const notationChars = notationCharsOf(profile)

  /** 基本正規化：保留體例符號（斷詞時要靠它們找構詞分界） */
  const baseNormalize = createNormalizer(normalizerOptions)

  /**
   * 族語搜尋鍵：基本正規化後再刪除體例符號。
   * 辭典體例符號不是語音，搜尋時忽略，讓 `sikis` 能直接找到 `sikis-`、`ha=ka` 能找到 `haka`。
   */
  const searchKey = createNormalizer({ ...normalizerOptions, removeChars: notationChars })

  /**
   * 族語斷詞：回傳去重後的搜尋鍵。
   * 含構詞分界的詞（`maatu-batan`、`tshay=a`）同時產生整詞與各部分（長度 ≥ 2）。
   * @param {string} text
   */
  function tokenize(text) {
    /** @type {Set<string>} */
    const out = new Set()
    // 撇號可能是語音（例如喉塞音），不當作標點去除
    for (const raw of baseNormalize(text).split(TOKEN_SEPARATORS)) {
      const whole = searchKey(raw)
      if (whole) out.add(whole)
      if (MORPHEME_SEPARATORS.test(raw)) {
        for (const part of raw.split(MORPHEME_SEPARATORS)) {
          const key = searchKey(part)
          if (Array.from(key).length >= 2) out.add(key)
        }
      }
    }
    return [...out]
  }

  /**
   * 把族語查詢切成「整詞」搜尋鍵（不拆構詞分界），用於多詞查詢。
   * @param {string} text
   */
  function splitWords(text) {
    return baseNormalize(text)
      .split(TOKEN_SEPARATORS)
      .map((w) => searchKey(w))
      .filter(Boolean)
  }

  /** 搜尋用的距離函式：設定檔的規則與成本，正規化使用 searchKey */
  const createSearchMetric = () => createMetricFromProfile(profile, { normalize: searchKey })

  return { notationChars, baseNormalize, searchKey, tokenize, splitWords, createSearchMetric }
}

/** 是否含漢字 @param {string} text */
export function hasHan(text) {
  return /\p{Script=Han}/u.test(text)
}

/** 釋義正規化：NFC、小寫、去附加符號（例如臺語羅馬字的聲調符號）、撇號統一 */
const glossNormalize = createNormalizer({ lowercase: true, stripDiacritics: true, preserve: [] })

/**
 * 英文或羅馬字釋義斷詞。
 * @param {string | null | undefined} text
 * @returns {string[]}
 */
export function glossTokens(text) {
  if (!text) return []
  return [
    ...new Set(
      glossNormalize(text)
        .split(/[^\p{L}\p{N}']+/u)
        .map((t) => t.replace(/^'+|'+$/gu, ''))
        .filter(Boolean),
    ),
  ]
}

/**
 * 中文比對用的正規化：去空白（標點原樣比對）。
 * @param {string | null | undefined} text
 */
export function zhNormalize(text) {
  return (text ?? '').normalize('NFC').replace(/\s+/gu, '')
}

/**
 * 判斷查詢要走哪一種搜尋。
 * - 含漢字 → 'zh'（中文釋義）
 * - 其他 → 'latin'（族語模糊搜尋＋英文／羅馬字釋義）
 * @param {string} query
 * @returns {'zh' | 'latin'}
 */
export function detectQueryMode(query) {
  return hasHan(query) ? 'zh' : 'latin'
}
