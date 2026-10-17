/**
 * 重構的安全網（公開的部分）：框架的可觀察輸出逐項取雜湊，與 test/golden/baseline.json 比對，必須逐位元相同。
 *
 *   npx vitest run test/golden                      比對
 *   GOLDEN_UPDATE=1 npx vitest run test/golden      行為刻意改變時更新基準（commit 時說明為什麼改變）
 *
 * 兩份語料，都是公開的：
 * - 示範站台 examples/minimal：網站資料（建到暫存目錄）、check、搜尋、句型搜尋、相近的詞、列表
 * - 仿巴宰語的合成語料（test/search/morph-corpus.js，隨機詞根加上巴宰語語法書中常見的詞綴；含構詞文法、
 *   自動派生圖與拆解表）：搜尋、句型搜尋、構詞說明、構詞搜尋、檢查清單、實驗室的步驟
 * 私有 repo 另有一份 golden，以真實的辭典資料涵蓋同樣的項目。
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { bcdpSteps, bcdpStateAt, dawgSteps, dawgStateAt, dpSteps, dpStateAt } from '../../app/src/lab/steps.ts'
import { Checklist, SearchEngine } from '../../src/search/index.ts'
import { SEARCH_METHODS } from '../../src/search/scoring.ts'
import { checkSite, extractMessages, loadSiteConfig, prepareSiteData } from '../../src/site/index.ts'
import { buildMorphEngine, morphCorpus } from '../search/morph-corpus.ts'
import { digest, digestBytes } from './canonical.ts'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const BASELINE = join(HERE, 'baseline.json')
const MINIMAL = fileURLToPath(new URL('../../examples/minimal/', import.meta.url))
const LEVELS = ['exact', 'normal', 'loose'] as const

/** 鍵 → 雜湊 */
const snapshot: Record<string, string> = {}
/** @param key */
async function record(key: string, fn: () => unknown) {
  let value
  try {
    value = await fn()
  } catch (err) {
    value = { thrown: String((err as any)?.message ?? err) }
  }
  snapshot[key] = digest(value)
}
const temp = mkdtempSync(join(tmpdir(), 'babizu-golden-'))
afterAll(() => rmSync(temp, { recursive: true, force: true }))

/** @param dir */
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))

/** 句型搜尋：超過時間預算時記成 TIMEOUT（內容取決於機器的速度） @param engine @param q */
function pattern(engine: SearchEngine, q: string, fuzziness: string) {
  try {
    const r = engine.searchPattern(q, { fuzziness: fuzziness as any })
    return r?.stats?.truncated && r.stats.elapsedMs >= 2000 ? 'TIMEOUT' : r
  } catch (err) {
    return { error: (err as any)?.code ?? String(err) }
  }
}

describe('golden：框架的輸出與基準逐位元相同', () => {
  it('示範站台', async () => {
    const site = await loadSiteConfig(MINIMAL)
    await prepareSiteData({ ...site, root: temp }, { log: () => {} })
    const data = join(temp, '.babizu', 'public', 'data')
    for (const file of walk(data).sort()) {
      const rel = relative(data, file).replaceAll('\\', '/')
      await record(`minimal:data:${rel}`, () => {
        if (rel !== 'manifest.json') return digestBytes(readFileSync(file))
        const { builtAt: _drop, ...rest } = JSON.parse(readFileSync(file, 'utf8'))
        return rest
      })
    }
    await record('minimal:check', async () => {
      const lines: string[] = []
      return { ok: await checkSite(MINIMAL, { log: (m) => lines.push(m) }), lines }
    })
    await record('messages', () => [...extractMessages()].sort())

    const read = (p: string) => JSON.parse(readFileSync(join(data, p), 'utf8'))
    const engine = new SearchEngine({ docs: read('search/docs.json'), lexicon: read('search/lexicon.json'), profile: read('search/language.json'), derivations: read('search/derivations.json'), csr: read('search/csr.json') })
    const words = new Set<string>()
    for (let k = 0; k < engine.size; k++) for (const w of String(engine.doc(k).text).split(/\s+/)) if (w.length >= 3) words.add(w)
    const queries = [...words].sort().slice(0, 150)
    queries.push('火', 'water', 'ralan', 'bunan', 'ʔa', 'zzzz')
    for (const q of queries) for (const fuzziness of LEVELS) await record(`minimal:search:${fuzziness}:${q}`, () => engine.search(q, { fuzziness }))
    // 對應組檢索（實驗性；示範站台設定了模型）
    for (const q of queries) for (const fuzziness of LEVELS) await record(`minimal:csr:${fuzziness}:${q}`, () => engine.search(q, { fuzziness, algorithm: 'csr', fields: ['native'] }))
    for (const q of ['_ ka _', '^ sapi', 'lalan $', 'sapi & !ka', '_* lalan', '"ralan"', '(']) for (const f of LEVELS) await record(`minimal:pattern:${f}:${q}`, () => pattern(engine, q, f))
    for (let k = 0; k < engine.size; k += 7) await record(`minimal:neighbors:${engine.doc(k).id}`, () => engine.neighbors(engine.doc(k).id))
    for (const sort of ['text', 'source']) await record(`minimal:list:${sort}`, () => engine.list({ sort: sort as any, limit: 100 }))
  }, 120_000)

  it('仿巴宰語的合成語料（構詞文法、自動派生圖、拆解表）', async () => {
    const { records, derivations: derived, lexical } = morphCorpus(20261015, 90)
    const { engine, derivations: graph, parses } = buildMorphEngine(records, { rootSyllableCost: { 1: 0.5, 3: 0.1, 4: 0.2 } })
    await record('corpus:derivations', () => graph)
    await record('corpus:parses', () => parses)
    const queries = [...new Set([...lexical, ...derived.map((d) => d.word)])].sort()
    // 方言變體：o ↔ u、詞尾 n ↔ l（巴宰–噶哈巫語的規則表中有的對應）
    const variants = queries.slice(0, 60).map((w) => w.replace(/u/, 'o').replace(/n$/, 'l'))
    for (const q of [...queries, ...variants]) for (const fuzziness of LEVELS) await record(`corpus:search:${fuzziness}:${q}`, () => engine.search(q, { fuzziness }))
    for (const q of queries.slice(0, 40)) {
      for (const m of SEARCH_METHODS) await record(`corpus:exclude:${m}:${q}`, () => engine.search(q, { exclude: [m] }))
      await record(`corpus:fields:native:${q}`, () => engine.search(q, { fields: ['native'] }))
      await record(`corpus:explainMorphology:${q}`, () => engine.explainMorphology(q, null))
    }
    for (const d of derived.slice(0, 80)) {
      await record(`corpus:explainMorphology:${d.word}:${d.root}`, () => engine.explainMorphology(d.word, d.root))
      await record(`corpus:explainNotes:${d.word}:${d.root}`, () => engine.explainNotes(d.word, d.root))
    }
    const PATTERNS = ['mu-…', 'pa-…', '…-an', '<in>…', 'm<in>u-…', '…-i $', 'ma-…-an', 'ta-…-i', '…-mu-…', 'pa-… _', '_ mu-…', 'ka-…', '…-en', 'xx-…', '<a>…', '@' + queries[0]]
    for (const q of PATTERNS) for (const f of LEVELS) await record(`corpus:pattern:${f}:${q}`, () => pattern(engine, q, f))

    const ms = engine.morphSearch as any
    for (const d of derived.slice(0, 120)) {
      await record(`corpus:morph:${d.word}`, () => {
        const hits = ms.search(d.word, { maxDistance: 1 })
        const prepared = ms.prepare(d.word, 1)
        return { hits, explained: hits.slice(0, 3).map((h: any) => ms.explainHit(prepared, h)) }
      })
    }
    for (const d of derived.slice(0, 30)) {
      await record(`corpus:lab:bcdp:${d.word}:${d.root}`, () => {
        const e = ms.explain(d.word, d.root, { maxDistance: 1 })
        const list = bcdpSteps(e)
        return { list, states: list.map((_, i) => bcdpStateAt(e, list, i)) }
      })
    }
    for (const q of queries.slice(0, 30)) {
      const target = queries[(queries.indexOf(q) + 7) % queries.length]
      await record(`corpus:lab:dp:${q}:${target}`, () => {
        const e = engine.metric.explain(q, target)
        const list = dpSteps(e)
        return { list, states: list.map((_, i) => dpStateAt(e, list, i)) }
      })
      await record(`corpus:lab:dawg:${q}`, () => {
        const events: any[] = []
        engine.index.search(q, { maxDistance: 1, onNode: (e: any) => events.push(e) })
        const list = dawgSteps(events)
        return { list, states: list.map((_, i) => dawgStateAt(list, i)) }
      })
    }
    const checklist = new Checklist(engine, ['dict'])
    await record('corpus:checklist:summary', () => checklist.summary())
    for (const kind of ['all', 'unknown', 'fuzzy']) await record(`corpus:checklist:tokens:${kind}`, () => checklist.tokenPage({ kind: kind as any, limit: 100 }))
    await record('corpus:checklist:sentences', () => checklist.sentencePage({ limit: 100 }))
  }, 300_000)

  it('與基準相同', () => {
    if (process.env.GOLDEN_UPDATE) {
      const sorted = Object.fromEntries(Object.entries(snapshot).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      writeFileSync(BASELINE, `${JSON.stringify(sorted, null, 1)}\n`)
      return
    }
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
    const keys = [...new Set([...Object.keys(baseline), ...Object.keys(snapshot)])].sort()
    const changed = keys.filter((k) => baseline[k] !== snapshot[k])
    expect(changed, `與基準不同的項目（${changed.length}／${keys.length}）`).toEqual([])
  })
})
