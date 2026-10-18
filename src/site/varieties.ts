/**
 * @file 站台設定中與檔案無關的部分：依語系攤開文字、語言變體的檢查與顏色。
 *
 * 不引用任何 Node 模組：建置端（config.ts、vite.ts）與瀏覽器（展示版在執行期由專案產生站台設定）共用。
 */

import type { ColorPair, ResolvedVariety } from './client.ts'

/** 可以依語系提供的文字：字串（所有語系共用）或 `{ 'zh-TW': …, en: … }`。 */
export type Localized = string | Record<string, string>

/** 語言變體（方言） */
export interface VarietyConfig {
  /** 代碼（小寫英數與連字號），記錄的 dialects 欄位使用 */
  code: string
  /** 顯示名稱 */
  label: Localized
  /** 所屬的上層變體；篩選上層時一併納入（例如愛蘭 ⊂ 巴宰） */
  parent?: string | null
  /** 色相（0–360）；未指定時繼承 parent 的色相，最上層預設依順序分配 */
  hue?: number
  /** 直接指定顏色（CSS 色值） */
  colors?: { light?: ColorPair; dark?: ColorPair }
}

/** 站台代號、變體代碼的格式 */
export const CODE = /^[a-z][a-z0-9-]*$/

/** 把 Localized 攤成每個語系都有值的物件（缺的語系回退到預設語系）。 */
export function localize(value: Localized | undefined | null, locales: string[], fallbackLocale: string): Record<string, string> | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return Object.fromEntries(locales.map((l) => [l, value]))
  const fallback = value[fallbackLocale] ?? Object.values(value)[0] ?? ''
  return Object.fromEntries(locales.map((l) => [l, value[l] ?? fallback]))
}

/**
 * 依序分配預設色相，讓沒指定顏色的變體也能彼此區分。
 * 選用在淺色背景上都夠清楚、彼此差距大的色相。
 */
const DEFAULT_HUES = [55, 175, 265, 330, 115, 20, 215, 85]

/** 語言變體的顏色（OKLCH）。從屬變體用同色相、較低彩度，表示「包含於上層」。 */
export function varietyColors(hue: number, child: boolean): { light: ColorPair; dark: ColorPair } {
  const c = child ? 0.45 : 1
  return {
    light: { fg: `oklch(${child ? 0.5 : 0.47} ${(0.1 * c).toFixed(3)} ${hue})`, bg: `oklch(0.955 ${(0.03 * c).toFixed(3)} ${hue})` },
    dark: { fg: `oklch(${child ? 0.8 : 0.82} ${(0.09 * c).toFixed(3)} ${hue})`, bg: `oklch(${child ? 0.3 : 0.31} ${(0.04 * c).toFixed(3)} ${hue})` },
  }
}

/**
 * 檢查並解析語言變體：代碼格式、重複、上層存在；顏色依色相推出。
 * @param errors 錯誤訊息加在這裡
 */
export function resolveVarieties(varietyInput: VarietyConfig[], locales: string[], defaultLocale: string, errors: string[]): ResolvedVariety[] {
  const codes = new Set<string>()
  for (const v of varietyInput) {
    if (!CODE.test(v.code ?? '')) errors.push(`變體代碼「${v.code}」格式不正確`)
    if (codes.has(v.code)) errors.push(`變體代碼「${v.code}」重複`)
    codes.add(v.code)
  }
  for (const v of varietyInput) {
    if (v.parent && !codes.has(v.parent)) errors.push(`變體 ${v.code} 的 parent「${v.parent}」不存在`)
  }
  // 色相：最上層的變體先決定（沒指定就依序分配），下層變體沿用最上層祖先的色相，
  // 這樣不論清單中的順序如何，從屬的變體都和上層同色系
  const hues = new Map<string, number>()
  let nextHue = 0
  for (const v of varietyInput) {
    if (!v.parent) hues.set(v.code, v.hue ?? DEFAULT_HUES[nextHue++ % DEFAULT_HUES.length])
  }
  const hueOf = (v: VarietyConfig): number => {
    if (v.hue !== undefined) return v.hue
    const seen = new Set<string>()
    let cur = v
    while (cur.parent && !seen.has(cur.code)) {
      seen.add(cur.code)
      const parent = varietyInput.find((p) => p.code === cur.parent)
      if (!parent) break
      if (parent.hue !== undefined) return parent.hue
      cur = parent
    }
    return hues.get(cur.code) ?? DEFAULT_HUES[0]
  }
  return varietyInput.map((v) => {
    const hue = hueOf(v)
    const derived = varietyColors(hue, !!v.parent)
    return {
      code: v.code,
      parent: v.parent ?? null,
      label: localize(v.label, locales, defaultLocale) ?? Object.fromEntries(locales.map((l) => [l, v.code])),
      colors: { light: v.colors?.light ?? derived.light, dark: v.colors?.dark ?? derived.dark },
    }
  })
}

/** 語言變體的顏色：每個變體一個 class，淺色與深色模式各一組 CSS 變數。 */
export function varietyCss(varieties: ResolvedVariety[]): string {
  return varieties
    .map(
      (v) =>
        `.variety-${v.code}{--variety-fg:${v.colors.light.fg};--variety-bg:${v.colors.light.bg}}` +
        `.dark .variety-${v.code}{--variety-fg:${v.colors.dark.fg};--variety-bg:${v.colors.dark.bg}}`,
    )
    .join('\n')
}
