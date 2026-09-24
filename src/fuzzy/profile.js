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
 *   "costs": { "substitute": 1.5, "delete": 1.0, "insert": 0.8 },
 *   "rules": [{ "category": "閃音", "rules": [["r", "l", 0.1]] }]
 * }
 * ```
 *
 * 完整說明見 docs/language-profile.md。
 */

import { CostModel } from './costs.js'
import { WeightedEditDistance } from './distance.js'
import { createNormalizer, DEFAULT_CHAR_MAP } from './normalize.js'
import { RuleSet } from './rules.js'

export const PROFILE_FORMAT = 'babizu-language-profile'
export const PROFILE_VERSION = 1

/**
 * @typedef {object} LanguageProfile
 * @property {'babizu-language-profile'} format
 * @property {1} version
 * @property {{
 *   lowercase?: boolean,
 *   charMap?: Record<string, string>,
 *   useDefaultCharMap?: boolean,
 *   stripDiacritics?: boolean,
 *   preserve?: string[],
 * }} [normalizer] 正規化選項；`charMap` 疊加在框架預設對應（撇號統一、ǝ→ə、全形空白）之上，
 *   `useDefaultCharMap: false` 可以不要預設對應
 * @property {string} [notationChars] 辭典體例符號（連字號、等號…），搜尋時忽略
 * @property {string[]} [boundaries] 詞邊界字元，決定「詞首」「詞尾」規則的範圍
 * @property {import('./costs.js').CostOptions} [costs] 基本編輯成本
 * @property {import('./rules.js').RuleGroup[]} [rules] 語音對應規則表（依分類分組）
 */

/** 沒有提供時的預設值 */
const DEFAULTS = Object.freeze({
  notationChars: '-=<>…~*',
  boundaries: [' '],
})

/**
 * 檢查設定檔格式，回傳錯誤訊息清單（空陣列表示正確）。
 * 只檢查結構；規則內容是否合理（例如權重非負）由 RuleSet 與 CostModel 在建立時檢查。
 * @param {unknown} profile
 * @returns {string[]}
 */
export function validateProfile(profile) {
  const errors = []
  if (!profile || typeof profile !== 'object') return ['語言設定檔必須是物件']
  const p = /** @type {Record<string, any>} */ (profile)
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
  try {
    JSON.stringify(profile)
  } catch {
    errors.push('語言設定檔必須可以 JSON 序列化')
  }
  return errors
}

/**
 * 檢查設定檔，有錯就丟出例外。
 * @param {unknown} profile
 * @returns {LanguageProfile}
 */
export function assertProfile(profile) {
  const errors = validateProfile(profile)
  if (errors.length > 0) throw new TypeError(`語言設定檔格式錯誤：\n- ${errors.join('\n- ')}`)
  return /** @type {LanguageProfile} */ (profile)
}

/**
 * 設定檔 → `createNormalizer` 的選項。
 * @param {LanguageProfile} profile
 * @returns {import('./normalize.js').NormalizerOptions}
 */
export function normalizerOptionsFromProfile(profile) {
  const n = profile.normalizer ?? {}
  return {
    lowercase: n.lowercase ?? true,
    charMap: { ...(n.useDefaultCharMap === false ? {} : DEFAULT_CHAR_MAP), ...(n.charMap ?? {}) },
    stripDiacritics: n.stripDiacritics ?? false,
    preserve: n.preserve ?? [],
  }
}

/** @param {LanguageProfile} profile */
export function notationCharsOf(profile) {
  return profile.notationChars ?? DEFAULTS.notationChars
}

/**
 * 依設定檔建立距離函式。
 * @param {LanguageProfile} profile
 * @param {Partial<import('./distance.js').MetricOptions>} [overrides] 例如換掉 normalize
 * @returns {WeightedEditDistance}
 */
export function createMetricFromProfile(profile, overrides = {}) {
  assertProfile(profile)
  return new WeightedEditDistance({
    costs: new CostModel(profile.costs ?? {}),
    rules: RuleSet.fromTable(profile.rules ?? []),
    normalize: createNormalizer(normalizerOptionsFromProfile(profile)),
    boundaries: profile.boundaries ?? DEFAULTS.boundaries,
    ...overrides,
  })
}

/**
 * 依設定檔建立規則集（每次都是新物件，可以自由開關分類，實驗室頁面用）。
 * @param {LanguageProfile} profile
 */
export function createRulesFromProfile(profile) {
  return RuleSet.fromTable(profile.rules ?? [])
}
