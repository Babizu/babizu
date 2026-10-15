import { describe, expect, it } from 'vitest'
import { Report } from '../../src/pipeline/report.ts'

describe('Report：轉接器的警告與錯誤', () => {
  it('分別計數，detail 只在有給時才出現', () => {
    const report = new Report()
    report.warn('a', '缺音檔')
    report.error('a', '重複的 id', { id: 'x' })
    report.warn('b', '空白的釋義')
    expect(report.errorCount).toBe(1)
    expect(report.warningCount).toBe(2)
    expect(report.items[0]).toEqual({ level: 'warn', source: 'a', message: '缺音檔' })
    expect(report.items[1]).toEqual({ level: 'error', source: 'a', message: '重複的 id', detail: { id: 'x' } })
  })

  it('摘要依來源分組，每個來源最多列出幾則，其餘註明數量', () => {
    const report = new Report()
    for (let k = 0; k < 5; k++) report.warn('a', `第 ${k} 則`)
    report.error('b', '壞掉了')
    const lines = report.summary(3).split('\n')
    expect(lines).toEqual(['  [a] 5 則', '    ! 第 0 則', '    ! 第 1 則', '    ! 第 2 則', '    …另有 2 則，見建置報告檔', '  [b] 1 則', '    ✗ 壞掉了'])
  })

  it('沒有任何項目時摘要是空字串', () => {
    expect(new Report().summary()).toBe('')
  })
})
