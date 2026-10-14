/**
 * 建置時的自動派生圖與拆解表（src/site/derivations.js）：以 worker_threads 平行計算、結果快取。
 * 平行計算的結果必須與單執行緒的 buildDerivationGraph、buildParseChart 完全相同；快取只在輸入相同時使用。
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildDerivationGraph, buildParseChart, buildSearchIndex } from '../../src/search/index.js'
import { buildDerivations } from '../../src/site/derivations.js'
import { PAZEH_PROFILE } from '../fixtures/pazeh.js'
import { morphCorpus, PAZEH_LIKE_GRAMMAR } from '../search/morph-corpus.js'

const cacheDir = mkdtempSync(join(tmpdir(), 'babizu-derivations-'))
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }))

const { records } = morphCorpus(7, 60)
/** @param {object} morphology */
const built = (morphology) =>
  JSON.parse(JSON.stringify(buildSearchIndex({ items: records.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict', 'corpus'], profile: { ...PAZEH_PROFILE, morphology } })))

describe('buildDerivations：平行計算與快取', () => {
  const index = built(PAZEH_LIKE_GRAMMAR)
  const input = { lexicon: index.lexicon, profile: index.profile, count: index.stats.terms, cacheDir }

  it('平行計算（worker_threads）的結果與單執行緒的 buildDerivationGraph、buildParseChart 相同', async () => {
    const result = await buildDerivations(input)
    expect(result.cached).toBe(false)
    expect(result.data).toEqual(buildDerivationGraph(index))
    expect(result.parses).toEqual(buildParseChart(index))
  }, 60_000)

  it('輸入相同時讀快取，結果相同；快取目錄只留最新的一份', async () => {
    const first = await buildDerivations(input)
    const again = await buildDerivations(input)
    expect(again.cached).toBe(true)
    expect(again.data).toEqual(first.data)
    expect(again.parses).toEqual(first.parses)
    expect(readdirSync(cacheDir).filter((n) => n.startsWith('derivations-'))).toHaveLength(1)
  }, 60_000)

  it('語言設定檔改變時重新計算，不用舊的快取', async () => {
    const other = built({ ...PAZEH_LIKE_GRAMMAR, rootSyllableCost: { 1: 0.5, 3: 0.1 } })
    const result = await buildDerivations({ lexicon: other.lexicon, profile: other.profile, count: other.stats.terms, cacheDir })
    expect(result.cached).toBe(false)
    expect(result.data).toEqual(buildDerivationGraph(other))
  }, 60_000)

  it('沒有構詞規格時是空的圖與拆解表', async () => {
    const plain = JSON.parse(JSON.stringify(buildSearchIndex({ items: records.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict', 'corpus'], profile: PAZEH_PROFILE })))
    const result = await buildDerivations({ lexicon: plain.lexicon, profile: plain.profile, count: plain.stats.terms, cacheDir })
    expect(result.data.edges).toEqual([])
    expect(result.parses.edges).toEqual([])
  })
})
