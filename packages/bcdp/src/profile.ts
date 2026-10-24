/**
 * @file 語言設定檔（language profile）：用純資料描述一個語言的搜尋規則。
 *
 * 一個辭典網站只要提供一份設定檔，框架就能替它建索引、做跨方言模糊搜尋。
 * 設定檔必須是可以 JSON 序列化的純資料（不能有函式或正規表示式），因為：
 *
 * - 建置端（Node.js）用它建立搜尋索引；
 * - 網站的 Web Worker 用它處理查詢；
 *
 * 兩邊讀的是同一份資料，搜尋鍵的算法才會完全一致。
 *
 * ```json
 * {
 *   "format": "babizu-language-profile",
 *   "version": 1,
 *   "normalizer": { "lowercase": true, "charMap": { "ʔ": "'" }, "stripDiacritics": true, "preserve": ["é"] },
 *   "notationChars": "-=<>…~*",
 *   "boundaries": [" "],
 *   "costs": { "substitute": 1.2, "delete": 1.0, "insert": 1.0 },
 *   "rules": [{ "category": "閃音", "rules": [["r", "l", 0.1]] }]
 * }
 * ```
 *
 * 完整說明見 docs/language-profile.md。
 */

import { CostModel, type CostOptions } from './costs.ts'
import { WeightedEditDistance, type MetricOptions } from './distance.ts'
import type { GrammarSpec } from './grammar.ts'
import { alternationRules, validateMorphology, type MorphologySpec } from './morphology.ts'
import { RuleSet, type RuleGroup } from './rules.ts'
import { createNormalizer, DEFAULT_CHAR_MAP, type NormalizerOptions } from './text-normalize.ts'

export const PROFILE_FORMAT = 'babizu-language-profile'
export const PROFILE_VERSION = 1

export interface LanguageProfile {
  format: 'babizu-language-profile'
  version: 1
  /**
   * 正規化選項；`charMap` 疊加在框架預設對應（撇號統一、ǝ→ə、全形空白）之上，
   * `useDefaultCharMap: false` 可以不要預設對應
   */
  normalizer?: {
    lowercase?: boolean
    charMap?: Record<string, string>
    useDefaultCharMap?: boolean
    stripDiacritics?: boolean
    preserve?: string[]
  }
  /** 辭典體例符號（連字號、等號…），搜尋時忽略 */
  notationChars?: string
  /** 詞邊界字元，決定「詞首」「詞尾」規則的範圍 */
  boundaries?: string[]
  /** 基本編輯成本 */
  costs?: CostOptions
  /** 語音對應規則表（依分類分組） */
  rules?: RuleGroup[]
  /** 構詞規格（平面清單或構詞文法寫法；選填） */
  morphology?: MorphologySpec | GrammarSpec
}

/** 沒有提供時的預設值 */
const DEFAULTS = Object.freeze({
  notationChars: '-=<>…~*',
  boundaries: [' '],
})

/**
 * 檢查設定檔格式，回傳錯誤訊息清單（空陣列表示正確）。
 * 只檢查結構；規則內容是否合理（例如權重非負）由 RuleSet 與 CostModel 在建立時檢查。
 */
export function validateProfile(profile: unknown): string[] {
  const errors: string[] = []
  if (!profile || typeof profile !== 'object') return ['語言設定檔必須是物件']
  // 內容還沒檢查過，所以各欄位以 any 讀取
  const p = profile as Record<string, any>
  if (p.format !== PROFILE_FORMAT) errors.push(`format 必須是 "${PROFILE_FORMAT}"`)
  if (p.version !== PROFILE_VERSION) errors.push(`version 必須是 ${PROFILE_VERSION}（目前支援的版本）`)
  if (p.normalizer !== undefined && (typeof p.normalizer !== 'object' || p.normalizer === null)) {
    errors.push('normalizer 必須是物件')
  }
  if (p.normalizer?.charMap !== undefined) {
    for (const [from, to] of Object.entries(p.normalizer.charMap ?? {})) {
      if (typeof to !== 'string') errors.push(`normalizer.charMap["${from}"] 必須是字串`)
    }
  }
  if (p.notationChars !== undefined && typeof p.notationChars !== 'string') errors.push('notationChars 必須是字串')
  if (p.boundaries !== undefined && !Array.isArray(p.boundaries)) errors.push('boundaries 必須是陣列')
  if (p.rules !== undefined && !Array.isArray(p.rules)) errors.push('rules 必須是陣列')
  errors.push(...validateMorphology(p.morphology))
  try {
    JSON.stringify(profile)
  } catch {
    errors.push('語言設定檔必須可以 JSON 序列化')
  }
  return errors
}

/** 檢查設定檔，有錯就丟出例外。 */
export function assertProfile(profile: unknown): LanguageProfile {
  const errors = validateProfile(profile)
  if (errors.length > 0) throw new TypeError(`語言設定檔格式錯誤：\n- ${errors.join('\n- ')}`)
  return profile as LanguageProfile
}

/** 設定檔 → `createNormalizer` 的選項。 */
export function normalizerOptionsFromProfile(profile: LanguageProfile): NormalizerOptions {
  const n = profile.normalizer ?? {}
  return {
    lowercase: n.lowercase ?? true,
    charMap: { ...(n.useDefaultCharMap === false ? {} : DEFAULT_CHAR_MAP), ...(n.charMap ?? {}) },
    stripDiacritics: n.stripDiacritics ?? false,
    preserve: n.preserve ?? [],
  }
}

export function notationCharsOf(profile: LanguageProfile): string {
  return profile.notationChars ?? DEFAULTS.notationChars
}

/**
 * 依設定檔建立距離函式。
 * @param overrides 例如換掉 normalize
 */
export function createMetricFromProfile(profile: LanguageProfile, overrides: Partial<MetricOptions> = {}): WeightedEditDistance {
  assertProfile(profile)
  return new WeightedEditDistance({
    costs: new CostModel(profile.costs ?? {}),
    rules: createRulesFromProfile(profile),
    normalize: createNormalizer(normalizerOptionsFromProfile(profile)),
    boundaries: profile.boundaries ?? DEFAULTS.boundaries,
    ...overrides,
  })
}

/** 依設定檔建立規則集（每次都是新物件，可以自由開關分類，實驗室頁面用）。 */
export function createRulesFromProfile(profile: LanguageProfile): RuleSet {
  // 構詞音變也是規則（只在詞素交界適用），與方言規則放在同一個 RuleSet：構詞搜尋與普通搜尋共用一次詞圖走訪
  return RuleSet.fromTable(profile.rules ?? []).addTable(alternationRules(profile.morphology))
}

/** 不可能的編輯成本：遠超過任何搜尋的上限（CostModel 只收有限數） */
const UNREACHABLE = 1e6

/**
 * 只有構詞音變的距離函式：構詞規格的交界規則（構詞音變），沒有方言規則，一般的替換、刪除、插入都不可能。
 *
 * 虛擬詞根（詞根不在詞庫中）的分析用它：這樣的分析中，不在詞庫裡的部分不能再加模糊——詞幹是查詢中原樣的一段，
 * 詞綴也必須原樣出現，只容許構詞音變（docs/bcdp.md 第 10 節，virtual-roots.ts）。
 * @param options.normalize 正規化（省略時依設定檔的 normalizer）；要與搜尋用的距離函式相同
 */
export function createAlternationMetricFromProfile(profile: LanguageProfile, { normalize }: { normalize?: (text: string) => string } = {}): WeightedEditDistance {
  return createMetricFromProfile(profile, {
    ...(normalize ? { normalize } : {}),
    rules: RuleSet.fromTable(alternationRules(profile.morphology)),
    costs: new CostModel({ substitute: UNREACHABLE, delete: UNREACHABLE, insert: UNREACHABLE }),
  })
}
