/**
 * @file 衍生關係圖的建置執行緒（src/site/derivations.js）：收到詞編號範圍就回傳那幾個詞的邊。
 */

import { parentPort, workerData } from 'node:worker_threads'
import { createDerivationAnalyzer } from '../search/derivations.js'

const analyzer = createDerivationAnalyzer(workerData)
parentPort?.on('message', ({ from, to }) => parentPort?.postMessage(analyzer.analyze(from, to)))
