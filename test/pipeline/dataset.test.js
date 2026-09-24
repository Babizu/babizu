import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineAdapter, exportDataset, readDataset, validateDataset, writeDataset } from '../../src/pipeline/index.js'
import { createCitation, createGroup, createRecord, createSense } from '../../src/schema/index.js'

/** 一個最小的合成來源 */
function makeSource(id, { reviewTracked = false } = {}) {
  return {
    id,
    title: `來源 ${id}`,
    shortTitle: id,
    type: 'wordlist',
    description: null,
    authors: [],
    year: null,
    publisher: null,
    citation: null,
    url: null,
    license: null,
    defaultDialects: [],
    orthography: null,
    browse: { mode: 'list', shardLabel: '頁' },
    reviewTracked,
    notes: [],
  }
}

function makeShard(sourceId, key, words, dialects = []) {
  const group = createGroup({ source: sourceId, localId: key, type: 'list', title: key })
  return {
    key,
    label: key,
    groups: [group],
    records: words.map((w, k) =>
      createRecord(
        { source: sourceId, localId: `${key}-${k}`, unit: 'word', text: w, citation: createCitation(`${sourceId} ${key}`) },
        { senses: [createSense({ zh: '詞' })], dialects, group: { id: group.id, role: 'item', parent: null, seq: k } },
      ),
    ),
  }
}

let dir
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'babizu-dataset-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('資料集', () => {
  const loaded = [
    { source: makeSource('a'), shards: [makeShard('a', 'p1', ['alaw', 'bintun'], ['north']), makeShard('a', 'p2', ['atun'])] },
    { source: makeSource('b'), shards: [makeShard('b', 'all', ['bintul'], ['south'])] },
  ]

  it('寫出後讀回完全相同，順序保留；sources.json 附上統計', async () => {
    await writeDataset(dir, loaded)
    const back = await readDataset(dir)
    expect(back.map((l) => l.source.id)).toEqual(['a', 'b'])
    expect(back[0].shards.map((s) => s.key)).toEqual(['p1', 'p2'])
    expect(back[0].shards[0].records).toEqual(loaded[0].shards[0].records)
    expect(back[0].source.stats).toMatchObject({ records: 3, word: 3, shards: 2 })
    // JSON 以縮排寫出（方便在版本管理中看 diff）
    const raw = await readFile(join(dir, 'records', 'a', 'p1.json'), 'utf8')
    expect(raw.split('\n').length).toBeGreaterThan(10)
  })

  it('重寫時清掉已不存在的分片', async () => {
    await writeDataset(dir, loaded)
    await writeDataset(dir, [loaded[0]])
    expect(await readdir(join(dir, 'records'))).toEqual(['a'])
  })

  it('驗證：schema、方言允許清單、id 唯一', () => {
    expect(validateDataset(loaded, { dialects: ['north', 'south'] })).toEqual([])
    // 站台沒有定義任何變體：沒標方言的記錄合法，標了就不合法
    expect(validateDataset([loaded[0]], { dialects: [] }).some((i) => i.level === 'error')).toBe(true)
    expect(validateDataset([{ source: makeSource('z'), shards: [makeShard('z', 'p', ['x'])] }], { dialects: [] })).toEqual([])
    const badDialect = validateDataset(loaded, { dialects: ['north'] })
    expect(badDialect.some((i) => i.level === 'error' && i.source === 'b')).toBe(true)
    const dup = [loaded[0], { source: makeSource('c'), shards: [loaded[0].shards[0]] }]
    expect(validateDataset(dup).some((i) => i.message.includes('重複'))).toBe(true)
  })

  it('不是資料集的目錄給出清楚的錯誤', async () => {
    await expect(readDataset(dir)).rejects.toThrow(/dataset\.json/)
  })
})

describe('exportDataset', () => {
  const adapter = (id, words) =>
    defineAdapter({ source: makeSource(id), load: async () => ({ shards: [makeShard(id, 'all', words)], assets: [] }) })

  it('停用的來源不會出現在匯出結果中', async () => {
    const logs = []
    const { ok } = await exportDataset({
      sources: [
        { adapter: adapter('public', ['alaw']), input: '.' },
        { adapter: adapter('restricted', ['secret']), input: '.', enabled: false },
      ],
      root: dir,
      outDir: join(dir, 'out'),
      log: (m) => logs.push(m),
    })
    expect(ok).toBe(true)
    const back = await readDataset(join(dir, 'out'))
    expect(back.map((l) => l.source.id)).toEqual(['public'])
    expect(await readdir(join(dir, 'out', 'records'))).toEqual(['public'])
    expect(logs.some((m) => m.includes('停用中') && m.includes('restricted'))).toBe(true)
  })

  it('驗證失敗時不寫出任何資料', async () => {
    const { ok, report } = await exportDataset({
      sources: [{ adapter: adapter('x', ['alaw']), input: '.' }],
      root: dir,
      outDir: join(dir, 'out'),
      dialects: [],
      log: () => {},
    })
    // 沒有方言也合法；改用重複 id 製造錯誤
    expect(ok).toBe(true)
    const dupAdapter = defineAdapter({
      source: makeSource('y'),
      load: async () => {
        const shard = makeShard('y', 'all', ['a'])
        return { shards: [shard, { ...shard, key: 'again' }], assets: [] }
      },
    })
    const bad = await exportDataset({ sources: [{ adapter: dupAdapter, input: '.' }], root: dir, outDir: join(dir, 'bad'), log: () => {} })
    expect(bad.ok).toBe(false)
    expect(bad.report.errorCount).toBeGreaterThan(0)
    await expect(readdir(join(dir, 'bad'))).rejects.toThrow()
    expect(report.errorCount).toBe(0)
  })
})

describe('pruneAssets', () => {
  /** @type {string} */
  let dir
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'babizu-prune-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('刪除沒有被引用的媒體檔與空目錄，保留引用中的檔案與其他目錄', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { pruneAssets } = await import('../../src/pipeline/index.js')
    for (const rel of ['media/a/keep.mp3', 'media/a/stale.mp3', 'media/gone/old.mp3', 'scans/p1.webp', 'records/x/y.json']) {
      await mkdir(join(dir, rel, '..'), { recursive: true })
      await writeFile(join(dir, rel), 'x')
    }
    const removed = await pruneAssets(
      [
        { kind: 'copy', from: '/src/keep.mp3', to: 'media/a/keep.mp3' },
        { kind: 'scan', from: '/src/p1.png', to: 'scans\\p1.webp' }, // Windows 路徑分隔符也要認得
      ],
      dir,
    )
    expect(removed.sort()).toEqual(['media/a/stale.mp3', 'media/gone/old.mp3'])
    expect(await readdir(join(dir, 'media'))).toEqual(['a'])
    expect(await readdir(join(dir, 'media', 'a'))).toEqual(['keep.mp3'])
    expect(await readdir(join(dir, 'scans'))).toEqual(['p1.webp'])
    // 資產目錄以外的東西不碰
    expect(await readdir(join(dir, 'records', 'x'))).toEqual(['y.json'])
  })
})
