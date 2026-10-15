/**
 * @file 自動派生圖與拆解表的建置執行緒（src/site/derivations.ts）：收到詞編號範圍就回傳那幾個詞的邊、拆法與虛擬詞根的候選。
 */

import { parentPort, workerData } from 'node:worker_threads'
import { createDerivationAnalyzer } from '../search/derivations.ts'

const analyzer = createDerivationAnalyzer(workerData)
parentPort?.on('message', ({ from, to }: { from: number; to: number }) => parentPort?.postMessage(analyzer.analyzeAll(from, to)))
