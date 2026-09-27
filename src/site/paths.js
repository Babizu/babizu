/**
 * @file 框架本身的路徑與內建語系。
 */

import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 框架根目錄（套件安裝在 node_modules 時也正確） */
export const FRAMEWORK_ROOT = fileURLToPath(new URL('../../', import.meta.url))
/** 網站前端原始碼 */
export const APP_DIR = join(FRAMEWORK_ROOT, 'app')

/** 原文語系：介面字串直接以中文寫在程式裡（src/site/messages.js），不需要譯文檔 */
export const SOURCE_LOCALE = 'zh-TW'

/** 譯文檔的語系（框架目錄 locales/<語系>.json，中文原文 → 譯文） */
const TRANSLATED_LOCALES = readdirSync(join(FRAMEWORK_ROOT, 'locales'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5))

/** 框架內建的介面語系：原文語系＋有譯文檔的語系 */
export const BUILTIN_LOCALES = [SOURCE_LOCALE, ...TRANSLATED_LOCALES.filter((l) => l !== SOURCE_LOCALE)]

/** 內建語系的顯示名稱（用各語系自己的語言寫） */
export const BUILTIN_LOCALE_NAMES = /** @type {Record<string, string>} */ ({ 'zh-TW': '中文', en: 'English' })

/**
 * 讀取內建語系的譯文（原文語系是空表：直接顯示程式裡的中文）。
 * @returns {Promise<Record<string, Record<string, string>>>}
 */
export async function loadBuiltinMessages() {
  /** @type {Record<string, Record<string, string>>} */
  const out = { [SOURCE_LOCALE]: {} }
  for (const locale of TRANSLATED_LOCALES) {
    out[locale] = JSON.parse(await readFile(join(FRAMEWORK_ROOT, 'locales', `${locale}.json`), 'utf8'))
  }
  return out
}
