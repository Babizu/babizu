/**
 * @file 從框架原始碼找出所有介面字串（中文原文）。
 *
 * 介面字串直接寫在程式裡（src/site/messages.js）：`t('…')`、`t('…', null, '語境')`、`msg('…')`、
 * `msg('…', '語境')`。這裡用正規式掃過前端（app/src）與框架程式（src），取出這些字面字串，
 * 供 `babizu locales` 列出譯文檔缺哪些、單元測試檢查內建譯文是否齊全。
 *
 * 只認得單引號的字面字串：用變數或樣板字串呼叫 t() 的地方掃不到，
 * 所以代碼 → 名稱的對照要寫成 msg() 表（見 app/src/lib/labels.js）。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { msg } from './messages.js'
import { FRAMEWORK_ROOT } from './paths.js'

const STRING = String.raw`'((?:[^'\\\n]|\\.)*)'`
/** t('原文'…)、t('原文', null, '語境')、msg('原文')、msg('原文', '語境') */
const CALL = new RegExp(String.raw`\b(t|msg)\(\s*${STRING}(?:\s*,\s*(?:null\s*,\s*)?${STRING})?`, 'g')

/** @param {string} s */
const unescape = (s) => s.replace(/\\(.)/g, '$1')

/** @param {string} dir @returns {string[]} */
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(full)
    return /\.(vue|js)$/.test(name) && !name.endsWith('.test.js') ? [full] : []
  })
}

/**
 * 一段原始碼中的介面字串鍵。
 * @param {string} code
 * @returns {string[]}
 */
export function extractFromSource(code) {
  // 註解裡的示範呼叫不算
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const keys = []
  for (const m of stripped.matchAll(CALL)) {
    // t() 的第二個參數是代入的參數，不是語境：只有 t('…', null, '語境') 才算
    const context = m[3] !== undefined && (m[1] === 'msg' || /,\s*null\s*,/.test(m[0])) ? unescape(m[3]) : undefined
    keys.push(msg(unescape(m[2]), context))
  }
  return keys
}

/**
 * 框架所有的介面字串鍵（排序、去重）。
 * @param {string} [root] 框架根目錄
 * @returns {string[]}
 */
export function extractMessages(root = FRAMEWORK_ROOT) {
  const keys = new Set()
  for (const dir of ['app/src', 'src']) {
    for (const file of sourceFiles(join(root, dir))) {
      for (const key of extractFromSource(readFileSync(file, 'utf8'))) keys.add(key)
    }
  }
  return [...keys].sort()
}
