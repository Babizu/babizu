/**
 * @file 工作台編輯「依語系的文字」（辭典名稱、變體名稱…）：專案裡可以是一個字串（所有語系共用）或「語系 → 文字」。
 */

import type { Localized } from '@babizu/site/varieties.ts'

/** 某個語系的文字（沒有時是空字串） */
export function textOf(value: Localized | undefined | null, locale: string): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : (value[locale] ?? '')
}

/**
 * 改某個語系的文字（字串會先展開成每個語系一份）。
 * @returns 新的值
 */
export function withText(value: Localized | undefined | null, locale: string, text: string, locales: string[]): Record<string, string> {
  const base: Record<string, string> = typeof value === 'string' ? Object.fromEntries(locales.map((l) => [l, value])) : { ...(value ?? {}) }
  base[locale] = text
  return base
}
