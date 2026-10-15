/**
 * 前端元件的型別參數只能用本檔定義的型別。
 *
 * `defineProps<T>()`、`defineEmits<T>()`、`defineModel<T>()` 的型別參數由 @vue/compiler-sfc 在建置時解析，
 * 推出執行期的 props 宣告；型別是從別的檔案引用的時候，它要靠 typescript 套件解析路徑——網站只安裝框架的
 * dependencies，沒有 typescript，建置會失敗。所以這些型別參數只能用本檔定義的型別（或內建型別）；
 * 需要引用別處的型別時，改用執行期的宣告加上 `Object as PropType<T>`（只是型別轉換，建置時不需要解析）。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP = join(import.meta.dirname, '../../app/src')

/** 遞迴列出 .vue 檔 */
const vueFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? vueFiles(join(dir, e.name)) : e.name.endsWith('.vue') ? [join(dir, e.name)] : []))

/** 從 s[i]（'<'）找到對應的 '>'（略過 => 的 >） */
function typeArgument(s: string, i: number): string {
  let depth = 0
  for (let k = i; k < s.length; k++) {
    if (s[k] === '<') depth++
    else if (s[k] === '>' && s[k - 1] !== '=') {
      depth--
      if (depth === 0) return s.slice(i + 1, k)
    }
  }
  return ''
}

describe('前端元件的型別參數', () => {
  it('defineProps／defineEmits／defineModel 的型別參數不引用別的檔案的型別', () => {
    const bad = []
    for (const file of vueFiles(APP)) {
      const script = /<script\b[^>]*>([\s\S]*?)<\/script>/.exec(readFileSync(file, 'utf8'))?.[1] ?? ''
      // 引用進來的名稱（import 與 import type 都算）
      const imported = new Set()
      for (const m of script.matchAll(/^import\s+(?:type\s+)?([^'"]*?)\s+from\s+['"][^'"]+['"]/gm)) {
        for (const name of m[1].replace(/[{}]/g, ',').split(',')) {
          const id = name.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()
          if (id) imported.add(id)
        }
      }
      for (const m of script.matchAll(/\bdefine(?:Props|Emits|Model)\s*(?=<)/g)) {
        // 屬性名稱、元組的標籤（name: 型別）與字串不是型別
        const arg = typeArgument(script, m.index + m[0].length)
          .replace(/'[^']*'|"[^"]*"/g, '')
          .replace(/[A-Za-z_$][\w$]*\??\s*:/g, '')
        for (const id of arg.match(/[A-Za-z_$][\w$]*/g) ?? []) {
          if (imported.has(id)) bad.push(`${relative(APP, file)}：${m[0]}<…${id}…>`)
        }
      }
    }
    expect(bad).toEqual([])
  })
})
