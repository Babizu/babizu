/**
 * @file 展示版的構詞分析 Web Worker（由建置 Worker 開幾個平行跑；見 build.worker.ts）：
 * 第一則訊息帶詞圖與語言設定檔，之後每收到一段詞編號就回傳那幾個詞的分析（與 Node 端的 src/site/derivations-worker.ts 相同）。
 */

import type { LanguageProfile, SerializedIndex } from '#bcdp'
import { createDerivationAnalyzer } from '@babizu/search/derivations.ts'

let analyzer: ReturnType<typeof createDerivationAnalyzer> | null = null

self.addEventListener('message', (event: MessageEvent<{ lexicon: SerializedIndex; profile: LanguageProfile } | { from: number; to: number }>) => {
  const m = event.data
  if ('lexicon' in m) {
    analyzer = createDerivationAnalyzer(m)
    return
  }
  self.postMessage(analyzer?.analyzeAll(m.from, m.to))
})
