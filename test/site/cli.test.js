/**
 * 指令列工具（bin/babizu.js）：以子行程執行，檢查輸出與結束碼。
 * dev、build、preview 由端對端測試涵蓋（npm run test:e2e 先建置示範站台再預覽）。
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const BIN = fileURLToPath(new URL('../../bin/babizu.js', import.meta.url))
const MINIMAL = fileURLToPath(new URL('../../examples/minimal/', import.meta.url))

/** @param {string[]} args */
function run(...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 60_000 })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

describe('babizu 指令', () => {
  it('check：示範站台通過，結束碼 0', () => {
    const r = run('check', MINIMAL)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('✓ 站台設定：babizu-demo')
    expect(r.stdout).toMatch(/✓ 資料集：\d+ 個來源、\d+ 筆記錄；0 個錯誤/)
  })

  it('locales：列出缺少的譯文或回報齊全，結束碼 0', () => {
    const r = run('locales', MINIMAL)
    expect(r.status).toBe(0)
    expect(r.stdout.length).toBeGreaterThan(0)
  })

  it('沒有指令或 help：印出用法', () => {
    for (const args of [[], ['help'], ['--help']]) {
      const r = run(...args)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('用法：babizu <指令>')
    }
  })

  it('不認得的指令：印出用法，結束碼 1', () => {
    const r = run('nonsense')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('不認得的指令：nonsense')
  })

  it('站台目錄不存在：清楚的錯誤，結束碼 1', () => {
    const r = run('check', fileURLToPath(new URL('./no-such-site/', import.meta.url)))
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/✗ /)
  })
})
