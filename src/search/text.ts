/**
 * @file 搜尋用的文字處理：族語搜尋鍵、斷詞、釋義斷詞、語言偵測。
 *
 * 建置端建索引與網站端處理查詢都必須用這裡的函式，而且用**同一份語言設定檔**，兩邊才會一致。
 *
 * - 與語言有關的函式（搜尋鍵、斷詞、距離函式）由 `createTextTools(profile)` 產生。
 * - 與語言無關的函式（釋義斷詞、中文正規化、語言偵測）直接匯出。
 */

import {
  createAlternationMetricFromProfile,
  createAnalyzer,
  createMetricFromProfile,
  createNormalizer,
  normalizerOptionsFromProfile,
  notationCharsOf,
  type Analyzer,
  type CostOptions,
  type LanguageProfile,
  type RuleSet,
  type WeightedEditDistance,
} from '#bcdp'

/**
 * 斷詞用的分隔字元：空白與中英文標點（保留撇號 ' 作為喉塞音）。
 * 句型搜尋的分句（babizu/pattern 的 sentences.ts）也用這一組，切出的詞與索引一致。
 */
export const TOKEN_SEPARATORS = /[\s,.;:!?"“”«»()[\]{}/\\|。，、；：！？「」『』（）［］]+/u

/** 詞內的構詞分界（連字號、等號、重疊號、中綴括號） */
const MORPHEME_SEPARATORS = /[-=~<>]+/u

export interface TextTools {
  /** 搜尋時忽略的體例符號 */
  notationChars: string
  /** 基本正規化（保留體例符號） */
  baseNormalize: (text: string) => string
  /** 族語搜尋鍵 */
  searchKey: (text: string) => string
  /** 族語斷詞（含構詞部分） */
  tokenize: (text: string) => string[]
  /** 只切整詞 */
  splitWords: (text: string) => string[]
  createSearchMetric: () => WeightedEditDistance
  /** 只有構詞音變的距離函式（虛擬詞根的分析用，見下方匯出的同名函式） */
  createAlternationMetric: () => WeightedEditDistance
  /** 構詞規格；語言設定檔沒有 `morphology` 時為 null */
  morphology: Analyzer | null
}

/**
 * 依語言設定檔建立文字工具。
 *
 * @example
 * const { searchKey, tokenize } = createTextTools(profile)
 * searchKey('Ma-dés')   // → 'madés'（體例符號 - 被忽略；é 依設定保留）
 * tokenize('imini ka kaidi tshay=a akhéhan?')
 * // → ['imini', 'ka', 'kaidi', 'tshaya', 'tshay', 'akhéhan']
 */
export function createTextTools(profile: LanguageProfile): TextTools {
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
   */
  function tokenize(text: string): string[] {
    const out = new Set<string>()
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

  /** 把族語查詢切成「整詞」搜尋鍵（不拆構詞分界），用於多詞查詢。 */
  function splitWords(text: string): string[] {
    return baseNormalize(text)
      .split(TOKEN_SEPARATORS)
      .map((w) => searchKey(w))
      .filter(Boolean)
  }

  /** 搜尋用的距離函式（見下方匯出的 createSearchMetric），與這裡的 searchKey 共用正規化 */
  const createSearchMetric = () => searchMetric(profile, searchKey)
  /** 只有構詞音變的距離函式（見下方匯出的 createAlternationMetric），與這裡的 searchKey 共用正規化 */
  const createAlternationMetric = () => createAlternationMetricFromProfile(profile, { normalize: searchKey })

  const morphology = profile.morphology ? createAnalyzer(profile.morphology, searchKey) : null

  return { notationChars, baseNormalize, searchKey, tokenize, splitWords, createSearchMetric, createAlternationMetric, morphology }
}

/**
 * 搜尋用的距離函式：語言設定檔的成本、規則與詞邊界，正規化使用族語搜尋鍵（刪除體例符號）。
 *
 * 建置、搜尋引擎與演算法實驗室都用這個函式建立距離函式，三者算出的距離才會一致。
 * 實驗室可以換掉規則或成本（使用者編輯過的），其餘（正規化、詞邊界）仍與搜尋相同。
 *
 * @param options.rules 取代設定檔的規則
 * @param options.costs 取代設定檔的成本
 */
export function createSearchMetric(profile: LanguageProfile, options: { rules?: RuleSet; costs?: CostOptions } = {}): WeightedEditDistance {
  const searchKey = createNormalizer({ ...normalizerOptionsFromProfile(profile), removeChars: notationCharsOf(profile) })
  return searchMetric(profile, searchKey, options)
}

function searchMetric(profile: LanguageProfile, searchKey: (text: string) => string, { rules, costs }: { rules?: RuleSet; costs?: CostOptions } = {}): WeightedEditDistance {
  return createMetricFromProfile(profile, { normalize: searchKey, ...(rules ? { rules } : {}), ...(costs ? { costs } : {}) })
}

/**
 * 只有構詞音變的距離函式：構詞規格的交界規則（構詞音變），沒有方言規則，一般的替換、刪除、插入都不可能。
 * 虛擬詞根的分析用它（BCDP 套件的 virtual-roots.ts）。正規化與詞邊界與 createSearchMetric 相同。
 */
export function createAlternationMetric(profile: LanguageProfile): WeightedEditDistance {
  const searchKey = createNormalizer({ ...normalizerOptionsFromProfile(profile), removeChars: notationCharsOf(profile) })
  return createAlternationMetricFromProfile(profile, { normalize: searchKey })
}

/** 是否含漢字 */
export function hasHan(text: string): boolean {
  return /\p{Script=Han}/u.test(text)
}

/** 釋義正規化：NFC、小寫、去附加符號（例如臺語羅馬字的聲調符號）、撇號統一 */
const glossNormalize = createNormalizer({ lowercase: true, stripDiacritics: true, preserve: [] })

/** 英文或羅馬字釋義斷詞。 */
export function glossTokens(text: string | null | undefined): string[] {
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

/** 中文比對用的正規化：去空白（標點原樣比對）。 */
export function zhNormalize(text: string | null | undefined): string {
  return (text ?? '').normalize('NFC').replace(/\s+/gu, '')
}

/**
 * 判斷查詢要走哪一種搜尋。
 * - 含漢字 → 'zh'（中文釋義）
 * - 其他 → 'latin'（族語模糊搜尋＋英文／羅馬字釋義）
 */
export function detectQueryMode(query: string): 'zh' | 'latin' {
  return hasHan(query) ? 'zh' : 'latin'
}
