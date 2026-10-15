/**
 * @file 建置報告：收集警告與錯誤，建置結束時輸出摘要與 JSON 檔。
 *
 * - 警告（warn）：資料可疑但可以繼續，例如 docx 與字幕文字不一致
 * - 錯誤（error）：資料不合格，建置結束時以非零代碼退出
 */

export interface ReportItem {
  level: 'warn' | 'error'
  /** 來源 id（或 'build'） */
  source: string
  message: string
  detail?: unknown
}

export class Report {
  readonly items: ReportItem[] = []

  /** @param source 來源 id（或 'build'） */
  warn(source: string, message: string, detail?: unknown): void {
    this.items.push({ level: 'warn', source, message, ...(detail === undefined ? {} : { detail }) })
  }

  error(source: string, message: string, detail?: unknown): void {
    this.items.push({ level: 'error', source, message, ...(detail === undefined ? {} : { detail }) })
  }

  get errorCount(): number {
    return this.items.filter((i) => i.level === 'error').length
  }

  get warningCount(): number {
    return this.items.filter((i) => i.level === 'warn').length
  }

  /**
   * 依來源分組的摘要文字。
   * @param maxPerSource 每個來源最多列出幾條
   */
  summary(maxPerSource = 8): string {
    const bySource = new Map<string, ReportItem[]>()
    for (const item of this.items) {
      const list = bySource.get(item.source) ?? []
      list.push(item)
      bySource.set(item.source, list)
    }
    const lines = []
    for (const [source, list] of bySource) {
      lines.push(`  [${source}] ${list.length} 則`)
      for (const item of list.slice(0, maxPerSource)) {
        lines.push(`    ${item.level === 'error' ? '✗' : '!'} ${item.message}`)
      }
      if (list.length > maxPerSource) lines.push(`    …另有 ${list.length - maxPerSource} 則，見建置報告檔`)
    }
    return lines.join('\n')
  }
}
