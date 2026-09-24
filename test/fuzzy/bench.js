/**
 * @file 效能基準：以隨機生成、形似巴宰語的 2 萬個詞建立索引，量測模糊查詢時間。
 *
 * 執行：npm run bench（在 packages/fuzzy-search 或根目錄）
 */

import { performance } from 'node:perf_hooks'
import { FuzzyIndex } from '../../src/fuzzy/index.js'
import { createPazehKaxabuMetric } from '../fixtures/pazeh.js'

/** 可重現的亂數 */
function createRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const random = createRandom(42)
const onsets = ['', 'b', 'd', 'k', 'l', 'm', 'n', 'ng', 'p', 'r', 's', 't', 'x', 'z', 'h', 'y', 'w', "'"]
const vowels = ['a', 'i', 'u', 'e', 'o', 'é', 'aa', 'ee']
const codas = ['', '', 'n', 'l', 'x', 'h', 'k', 't', 's', 'ng', 'y', 'w']
const pick = (list) => list[Math.floor(random() * list.length)]

/** 生成一個 CV(C) 音節組成的假詞 */
function fakeWord() {
  const syllables = 1 + Math.floor(random() * 4)
  let w = ''
  for (let k = 0; k < syllables; k++) w += pick(onsets) + pick(vowels)
  return w + pick(codas)
}

const WORDS = 20000
const QUERIES = 300
const metric = createPazehKaxabuMetric()
const index = new FuzzyIndex(metric)

let t0 = performance.now()
const vocabulary = new Set()
while (vocabulary.size < WORDS) vocabulary.add(fakeWord())
for (const w of vocabulary) index.add(w)
index.freeze()
const buildMs = performance.now() - t0
console.log(
  `建立索引：${index.size} 詞、${index.dawg.nodeCount} 個節點、${index.dawg.edgeCount} 條邊，${buildMs.toFixed(1)} ms`,
)

t0 = performance.now()
const serialized = JSON.stringify(index.serialize())
const restored = FuzzyIndex.deserialize(JSON.parse(serialized), metric)
console.log(
  `序列化往返：${(serialized.length / 1024).toFixed(0)} KB，${(performance.now() - t0).toFixed(1)} ms（${restored.size} 詞）`,
)

const queries = Array.from({ length: QUERIES }, () => fakeWord())
for (const maxDistance of [0.3, 1, 1.5]) {
  let totalVisited = 0
  let totalResults = 0
  const times = []
  for (const q of queries) {
    const start = performance.now()
    const { results, stats } = index.searchWithStats(q, { maxDistance })
    times.push(performance.now() - start)
    totalVisited += stats.visitedNodes
    totalResults += results.length
  }
  times.sort((a, b) => a - b)
  const avg = times.reduce((s, t) => s + t, 0) / times.length
  const p95 = times[Math.floor(times.length * 0.95)]
  console.log(
    `maxDistance=${maxDistance}：平均 ${avg.toFixed(2)} ms、p95 ${p95.toFixed(2)} ms、` +
      `平均走訪 ${(totalVisited / QUERIES).toFixed(0)} 節點、平均 ${(totalResults / QUERIES).toFixed(1)} 筆結果`,
  )
}
