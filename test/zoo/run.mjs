/**
 * @file 錯誤解法動物園（mutation zoo）：確認測試真的抓得到錯。
 *
 *   npm run zoo              全部突變
 *   npm run zoo -- 3 7       只跑第 3、7 號
 *
 * 做法（competitive-programming 的 validating-solutions：每個「錯誤解法」都必須被測試殺掉）：
 * 1. 把 src、test、locales、app 與測試設定複製到暫存目錄（node_modules 以連結共用），正式的檔案一律不動。
 * 2. 每次只套用一個具名的突變（一段程式換成常見的錯誤寫法），跑 node 端的單元測試。
 * 3. 測試失敗＝突變被殺掉；測試全過＝突變存活，表示那個錯誤沒有測試守著，整體以非零結束。
 *
 * 突變清單在 ./mutants.js，每一項寫明它模擬什麼錯誤、預期由哪個測試殺掉。
 * 刻意不收的突變（等價突變、只影響效能或說明文字的）也列在那裡，附理由。
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MUTANTS } from './mutants.js'

const ROOT = resolve(import.meta.dirname, '../..')
const only = new Set(process.argv.slice(2).map(Number))
const selected = MUTANTS.map((m, k) => ({ ...m, id: k + 1 })).filter((m) => only.size === 0 || only.has(m.id))

/**
 * 遞迴複製（不用 fs.cpSync：Node 22 在 Windows、路徑含非 ASCII 字元時會當掉）
 * @param {string} from
 * @param {string} to
 */
function copyDir(from, to) {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) copyDir(join(from, entry.name), join(to, entry.name))
    else copyFileSync(join(from, entry.name), join(to, entry.name))
  }
}

const work = mkdtempSync(join(tmpdir(), 'babizu-zoo-'))
const modules = join(work, 'node_modules')
for (const dir of ['src', 'test', 'locales', 'app']) copyDir(join(ROOT, dir), join(work, dir))
for (const file of ['package.json', 'vitest.config.js']) copyFileSync(join(ROOT, file), join(work, file))
symlinkSync(join(ROOT, 'node_modules'), modules, 'junction')
const vitest = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')

/** 跑 node 端的單元測試（第一個失敗就停） */
const runTests = () =>
  spawnSync(process.execPath, [vitest, 'run', '--project', 'node', '--bail', '1'], { cwd: work, encoding: 'utf8' })

let failed = false
try {
  // 未突變時必須全過，否則「被殺掉」沒有意義
  const baseline = runTests()
  if (baseline.status !== 0) throw new Error(`未突變的測試就失敗了：\n${baseline.stdout.slice(-2000)}`)
  console.log(`基準：測試全過（${work}）\n`)

  for (const m of selected) {
    const path = join(work, m.file)
    const original = readFileSync(path, 'utf8')
    const count = original.split(m.find).length - 1
    if (count !== 1) {
      console.log(`✗ #${m.id} ${m.name}：要替換的程式出現 ${count} 次（應為 1 次），突變清單需要更新`)
      failed = true
      continue
    }
    writeFileSync(path, original.replace(m.find, m.replace))
    const started = performance.now()
    const r = runTests()
    writeFileSync(path, original)
    const seconds = ((performance.now() - started) / 1000).toFixed(1)
    // 第一個失敗的測試檔（--bail 1，通常就是殺掉它的那個）
    const killedBy = /(test\/\S+\.test\.js)/.exec(`${r.stdout}\n${r.stderr}`)?.[1] ?? '（見輸出）'
    if (r.status === 0) {
      console.log(`✗ #${m.id} ${m.name}：存活（${seconds} s）——${m.why}`)
      failed = true
    } else {
      console.log(`✓ #${m.id} ${m.name}：被殺掉，${killedBy}（${seconds} s）`)
    }
  }
} finally {
  // 先拆掉 node_modules 的連結，免得刪除暫存目錄時連到正式的 node_modules
  unlinkSync(modules)
  rmSync(work, { recursive: true, force: true })
}
console.log(failed ? '\n有突變存活或清單過期' : `\n${selected.length} 個突變全部被殺掉`)
process.exit(failed ? 1 : 0)
