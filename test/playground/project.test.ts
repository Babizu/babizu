/**
 * 展示版的專案（src/playground/）：檢查、轉成資料集、在記憶體建置（與 `babizu build` 的程式等價）、
 * 站台設定、網站起始包、規則列的兩種寫法。
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { afterAll, describe, expect, it } from 'vitest'
import { buildProject } from '../../src/playground/build.ts'
import { siteStarterFiles } from '../../src/playground/export.ts'
import { hasErrors, newProject, projectToDataset, validateProject, type PlaygroundProject } from '../../src/playground/project.ts'
import { ruleRowFrom, ruleRowProblem, ruleRowView } from '../../src/playground/rule-rows.ts'
import { playgroundClientSite } from '../../src/playground/site.ts'
import { createZip, crc32 } from '../../src/playground/zip.ts'
import { buildDerivations } from '../../src/site/derivations.ts'
import { analyzeInProcess, buildSiteData } from '../../src/site/site-data.ts'
import type { ClientSite } from '../../src/site/client.ts'
import FIXTURE from '../fixtures/site-client.ts'

/** 測試用的站台設定（fixture 的型別比 ClientSite 寬：語系欄位是一般的 Record） */
const SITE = FIXTURE as unknown as ClientSite

const SAMPLE: PlaygroundProject = JSON.parse(readFileSync(new URL('../../examples/playground/sample-project.json', import.meta.url), 'utf8'))
const sha1Hex = async (text: string) => createHash('sha1').update(text).digest('hex')
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

describe('檢查專案', () => {
  it('範例專案、空白專案都可以建置', () => {
    expect(validateProject(SAMPLE)).toEqual([])
    expect(validateProject(newProject())).toEqual([])
  })

  it('編號重複或格式不對、沒有詞形、方言不在變體清單、規則的權重是負的：都指出位置，訊息說明是哪一列', () => {
    const p = clone(SAMPLE)
    p.words[1].id = p.words[0].id
    p.words[2].id = 'a b'
    p.words[3].text = ' '
    p.sentences[0].dialects = ['west']
    p.sentences[2].dialects = ['west']
    p.profile.rules = [{ category: 'x', rules: [['a', 'b', -1]] }]
    const issues = validateProject(p)
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(['words[1].id', 'words[2].id', 'words[3].text', 'sentences[0].dialects', 'profile.rules[0].rules[0]']))
    expect(issues.every((i) => i.level === 'error')).toBe(true)
    // 同一個不存在的變體只報一次，列出所有的列
    const west = issues.find((i) => i.path === 'sentences[0].dialects')
    expect(west).toMatchObject({ paths: ['sentences[0].dialects', 'sentences[2].dialects'], params: { code: 'west', count: 2, rows: '1, 3' } })
    expect(west?.message).toContain('例句有 2 列用到不在清單中的語言變體「west」（第 1, 3 列）')
    expect(issues.find((i) => i.path === 'words[1].id')?.message).toContain(`和第 1 列重複`)
  })

  it('變體：代碼格式、上層不存在或循環；構詞：空白、帶連字號的詞綴', () => {
    const p = clone(SAMPLE)
    p.varieties = [
      { code: 'a', label: 'A', parent: 'b' },
      { code: 'b', label: 'B', parent: 'a' },
      { code: 'North', label: 'N' },
      { code: 'c', label: 'C', parent: 'zz' },
    ]
    for (const r of [...p.words, ...p.sentences]) r.dialects = []
    p.profile.morphology = { prefixes: [{ form: '' }, { form: 'ma-' }], suffixes: [] }
    const messages = validateProject(p).map((i) => `${i.path} ${i.message}`)
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^varieties\[0\]\.parent .*循環（a → b → a）/u),
        expect.stringMatching(/^varieties\[2\]\.code .*「North」只能用小寫/u),
        expect.stringMatching(/^varieties\[3\]\.parent .*「zz」不在變體清單中/u),
        expect.stringMatching(/^profile\.morphology\.prefixes\[0\] 構詞：前綴第 1 個沒有寫法/u),
        expect.stringMatching(/^profile\.morphology\.prefixes\[1\] 構詞：前綴「ma-」不用寫連字號/u),
      ]),
    )
  })

  it('完全重複的列是提醒，不擋建置', () => {
    const p = clone(SAMPLE)
    p.words.push({ ...p.words[0], id: 'dup' })
    const issues = validateProject(p)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ level: 'warning', path: `words[${p.words.length - 1}].text` })
    expect(hasErrors(issues)).toBe(false)
  })

  it('不是專案：格式、名稱', () => {
    expect(validateProject(null)).toMatchObject([{ path: '', level: 'error', message: '這不是專案（內容必須是一個 JSON 物件）' }])
    expect(validateProject({ ...newProject(), format: 'x', title: { 'zh-TW': ' ' } }).map((i) => i.path)).toEqual(['format', 'title'])
  })
})

describe('專案 → 資料集', () => {
  const [{ source, shards }] = projectToDataset(SAMPLE)

  it('一個來源、詞與例句兩個分片；記錄的編號就是專案的編號，順序與群組照專案', () => {
    expect(source.id).toBe('playground')
    expect(source.title).toBe('巴宰語與噶哈巫語（範例專案）')
    expect(shards.map((s) => [s.key, s.records.length])).toEqual([
      ['words', SAMPLE.words.length],
      ['sentences', SAMPLE.sentences.length],
    ])
    expect(shards[0].records[0]).toMatchObject({ id: 'playground:w1', text: 'turu', unit: 'word', dialects: ['pazeh'], pos: 'num', group: { id: 'playground:words', seq: 0 } })
    expect(shards[1].records[0]).toMatchObject({ unit: 'sentence', senses: [{ zh: '父親在打小孩', en: 'Father is hitting the child.' }], notes: ['《巴宰語詞典》p.80–81，baket- 條下例句'] })
    expect(source.stats).toMatchObject({ records: SAMPLE.words.length + SAMPLE.sentences.length, sentence: SAMPLE.sentences.length })
  })

  it('其他寫法是變體（~），備註是 notes，含空白的詞形是片語', () => {
    const p = clone(SAMPLE)
    p.words[0] = { ...p.words[0], text: 'ka lalan', alt: ['ka ralan'], note: '測試' }
    const r = projectToDataset(p)[0].shards[0].records[0]
    expect(r).toMatchObject({ unit: 'phrase', variants: [{ relation: '~', text: 'ka ralan' }], notes: ['測試'] })
  })
})

describe('在記憶體建置（與 babizu build 同一份程式）', () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'babizu-playground-'))
  afterAll(() => rmSync(cacheDir, { recursive: true, force: true }))

  it('瀏覽器的單一執行緒分析與 Node 的 worker_threads（prepareSiteData 用的）產生逐位元相同的網站資料', async () => {
    const browser = await buildProject(SAMPLE, { sha1Hex, analyze: analyzeInProcess(), builtAt: 'x' })
    const node = await buildSiteData(
      { loaded: projectToDataset(SAMPLE), profile: SAMPLE.profile, varieties: [{ code: 'pazeh', parent: null }, { code: 'kaxabu', parent: null }] },
      { derive: (args) => buildDerivations({ ...args, cacheDir }) },
    )
    for (const [path, content] of node.files) expect(JSON.stringify(browser.files[path]), path).toBe(JSON.stringify(content))
    expect(Object.keys(browser.files).sort()).toEqual([...node.files.map(([p]) => p), 'manifest.json'].sort())
    // 範例有構詞：自動派生圖不是空的（baket → mubaket、saabaket…）
    expect(browser.stats.derivationEdges).toBeGreaterThan(0)
  }, 60_000)

  it('manifest：版本是檔案雜湊的雜湊；同一份專案版本相同，改一個詞就不同', async () => {
    const a = await buildProject(SAMPLE, { sha1Hex, analyze: analyzeInProcess(), builtAt: 'x' })
    const b = await buildProject(SAMPLE, { sha1Hex, analyze: analyzeInProcess(), builtAt: 'y' })
    const changed = clone(SAMPLE)
    changed.words[0].zh = '道路'
    const c = await buildProject(changed, { sha1Hex, analyze: analyzeInProcess(), builtAt: 'x' })
    expect(a.version).toBe(b.version)
    expect(c.version).not.toBe(a.version)
    expect(a.files['manifest.json']).toMatchObject({ version: a.version, sources: ['playground'], counts: { records: SAMPLE.words.length + SAMPLE.sentences.length } })
  })

  it('進度：分析每一段都回報；步驟依序', async () => {
    const steps: string[] = []
    const progress: number[] = []
    const { stats } = await buildProject(SAMPLE, { sha1Hex, analyze: analyzeInProcess((done) => progress.push(done)), onStep: (s) => steps.push(s) })
    expect(steps).toEqual(['dataset', 'index', 'derivations', 'done'])
    expect(progress.at(-1)).toBe(stats.terms) // 詞圖的詞數（含例句中的詞）
    expect(stats.terms).toBeGreaterThan(SAMPLE.words.length)
  })
})

describe('站台設定', () => {
  it('名稱、變體、語言設定檔、範例、實驗室的詞對來自專案；介面字串沿用建置時的設定', () => {
    const site = playgroundClientSite(SITE, SAMPLE)
    expect(site.title).toEqual({ 'zh-TW': '巴宰語與噶哈巫語（範例專案）', en: 'Pazeh and Kaxabu (sample project)' })
    expect(site.varieties.map((v) => [v.code, v.parent])).toEqual([
      ['pazeh', null],
      ['kaxabu', null],
    ])
    expect(site.profile).toBe(SAMPLE.profile)
    expect(site.examples[0].q).toBe('turu')
    expect(site.lab.pairs[0]).toEqual(['turu', "tu'u"])
    expect(site.lab.morph.examples[0]).toEqual(['minubaket', 'baket'])
    expect(site).toMatchObject({ playground: true, csr: false, messages: SITE.messages, locales: SITE.locales })
  })

  it('沒有範例時以前幾個詞當範例、前兩個詞當實驗室的詞對；沒有構詞時沒有構詞例子', () => {
    const p = { ...clone(SAMPLE), examples: undefined, lab: undefined }
    delete p.profile.morphology
    const site = playgroundClientSite(SITE, p)
    expect(site.examples.map((e) => e.q)).toEqual(['turu', "tu'u", 'tuturu'])
    expect(site.lab.pairs).toEqual([['turu', "tu'u"]])
    expect(site.lab.morph.examples).toEqual([])
  })
})

describe('網站起始包與 zip', () => {
  it('站台設定、語言設定檔與資料集（與 writeDataset 相同的格式）', async () => {
    const files = new Map(siteStarterFiles(SAMPLE, 'demo-dict'))
    expect([...files.keys()]).toEqual(['README.md', 'babizu.config.js', 'language.json', 'data/records/playground/words.json', 'data/records/playground/sentences.json', 'data/sources.json', 'data/dataset.json'])
    expect(files.get('babizu.config.js')).toContain('id: "demo-dict"')
    expect(files.get('babizu.config.js')).toContain('"code": "kaxabu"')
    expect(JSON.parse(files.get('language.json') as string)).toEqual(SAMPLE.profile)
    expect(JSON.parse(files.get('data/dataset.json') as string)).toMatchObject({ format: 'babizu-dataset', sources: [{ id: 'playground' }] })
    const zip = createZip([...files])
    const back = Object.entries(unzipSync(zip)).map(([name, data]) => [name, new TextDecoder().decode(data)])
    expect(back).toEqual([...files])
  })

  it('CRC-32（標準的測試向量）', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926')
  })
})

describe('規則列的兩種寫法', () => {
  it('陣列與物件互轉；沒有額外設定時寫回陣列', () => {
    expect(ruleRowView(['r', 'l', 0.1])).toEqual({ source: 'r', target: 'l', weight: 0.1 })
    expect(ruleRowFrom({ source: 'r', target: 'l', weight: 0.1 })).toEqual(['r', 'l', 0.1])
    const obj = ruleRowFrom({ source: 'h', target: '', weight: 0.2, position: 'final', bidirectional: false })
    expect(obj).toEqual({ source: 'h', target: '', weight: 0.2, position: 'final', bidirectional: false })
    expect(ruleRowView(obj)).toEqual({ source: 'h', target: '', weight: 0.2, position: 'final', bidirectional: false })
  })

  it('兩邊都空白、權重不是非負的數', () => {
    expect(ruleRowProblem({ source: '', target: '', weight: 0.1 })).toBe('empty')
    expect(ruleRowProblem({ source: 'a', target: '', weight: -1 })).toBe('weight')
    expect(ruleRowProblem({ source: 'a', target: '', weight: Number.NaN })).toBe('weight')
    expect(ruleRowProblem({ source: 'a', target: 'b', weight: 0 })).toBeNull()
  })
})
