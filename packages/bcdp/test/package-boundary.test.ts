/**
 * 套件的邊界：BCDP 是零依賴的獨立套件。原始碼只能引用套件內的檔案（不能引用 babizu、Node 的內建模組或其他套件），
 * 測試只能引用套件內的檔案與測試框架。babizu 可以引用套件，反過來不行。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE = fileURLToPath(new URL('..', import.meta.url))

/** 目錄下的原始碼檔（.ts；型別宣告檔除外）。檔案清單是空的就失敗，免得副檔名對不上時測試什麼都沒查就通過 */
const files = (dir: string): string[] => {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((name) => {
      const path = join(d, name)
      return statSync(path).isDirectory() ? walk(path) : /\.ts$/.test(name) && !name.endsWith('.d.ts') ? [path] : []
    })
  const found = walk(dir)
  if (found.length === 0) throw new Error(`${dir} 中沒有原始碼檔`)
  return found
}

/** 檔案中的 import／export from 與動態 import（不含註解中的例子） */
function specifiersOf(file: string) {
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  return [...code.matchAll(/(?:^|\s)(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)].map((m) => m[1] ?? m[2])
}

/** 這個引用是否留在套件裡 @param file */
const staysInside = (file: string, spec: string) => spec.startsWith('.') && !relative(PACKAGE, resolve(file, '..', spec)).startsWith('..')

describe('BCDP 套件的邊界', () => {
  it('原始碼只引用套件內的檔案：沒有 babizu、Node 的內建模組或其他套件', () => {
    const offenders = files(join(PACKAGE, 'src')).flatMap((file) =>
      specifiersOf(file)
        .filter((spec) => !staysInside(file, spec))
        .map((spec) => `${relative(PACKAGE, file)}：${spec}`),
    )
    expect(offenders).toEqual([])
  })

  it('測試只引用套件內的檔案、測試框架與 Node 的內建模組', () => {
    const allowed = (spec: string) => spec === 'vitest' || spec.startsWith('node:')
    const offenders = files(join(PACKAGE, 'test')).flatMap((file) =>
      specifiersOf(file)
        .filter((spec) => !staysInside(file, spec) && !allowed(spec))
        .map((spec) => `${relative(PACKAGE, file)}：${spec}`),
    )
    expect(offenders).toEqual([])
  })
})
