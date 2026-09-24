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

/** 框架內建的介面語系 */
export const BUILTIN_LOCALES = readdirSync(join(FRAMEWORK_ROOT, 'locales'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5))

/**
 * 讀取內建語系的介面字串（已攤平成點號鍵）。
 * @returns {Promise<Record<string, Record<string, string>>>}
 */
export async function loadBuiltinMessages() {
  const { flattenMessages } = await import('./config.js')
  /** @type {Record<string, Record<string, string>>} */
  const out = {}
  for (const locale of BUILTIN_LOCALES) {
    out[locale] = flattenMessages(JSON.parse(await readFile(join(FRAMEWORK_ROOT, 'locales', `${locale}.json`), 'utf8')))
  }
  return out
}
