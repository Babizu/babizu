/**
 * 展示版的專案（src/playground/）：檢查、轉成資料集、在記憶體建置（與 `babizu build` 的程式等價）、
 * 站台設定、網站起始包、規則列的兩種寫法、讀 .xlsx。
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { buildProject } from '../../src/playground/build.ts'
import { siteStarterFiles } from '../../src/playground/export.ts'
import { newProject, projectToDataset, validateProject, type PlaygroundProject } from '../../src/playground/project.ts'
import { ruleRowFrom, ruleRowProblem, ruleRowView } from '../../src/playground/rule-rows.ts'
import { playgroundClientSite } from '../../src/playground/site.ts'
import { readXlsx, unzipText } from '../../src/playground/xlsx.ts'
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

  it('編號重複或格式不對、沒有詞形、方言不在變體清單、規則的權重是負的：都指出位置', () => {
    const p = clone(SAMPLE)
    p.words[1].id = p.words[0].id
    p.words[2].id = 'a b'
    p.words[3].text = ' '
    p.sentences[0].dialects = ['west']
    p.profile.rules = [{ category: 'x', rules: [['a', 'b', -1]] }]
    const paths = validateProject(p).map((i) => i.path)
    expect(paths).toEqual(expect.arrayContaining(['words[1].id', 'words[2].id', 'words[3].text', 'sentences[0].dialects', 'profile']))
  })

  it('不是專案：格式、名稱', () => {
    expect(validateProject(null)).toEqual([{ path: '', message: '專案必須是物件' }])
    expect(validateProject({ ...newProject(), format: 'x', title: { 'zh-TW': ' ' } }).map((i) => i.path)).toEqual(['format', 'title'])
  })
})

describe('專案 → 資料集', () => {
  const [{ source, shards }] = projectToDataset(SAMPLE)

  it('一個來源、詞與例句兩個分片；記錄的編號就是專案的編號，順序與群組照專案', () => {
    expect(source.id).toBe('playground')
    expect(source.title).toBe('示範語（範例專案）')
    expect(shards.map((s) => [s.key, s.records.length])).toEqual([
      ['words', SAMPLE.words.length],
      ['sentences', SAMPLE.sentences.length],
    ])
    expect(shards[0].records[0]).toMatchObject({ id: 'playground:w1', text: 'ralan', unit: 'word', dialects: ['north'], pos: 'n', group: { id: 'playground:words', seq: 0 } })
    expect(shards[1].records[0]).toMatchObject({ unit: 'sentence', senses: [{ zh: '水在流', en: 'The water flows.' }] })
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
      { loaded: projectToDataset(SAMPLE), profile: SAMPLE.profile, varieties: [{ code: 'north', parent: null }, { code: 'south', parent: null }, { code: 'coast', parent: 'south' }] },
      { derive: (args) => buildDerivations({ ...args, cacheDir }) },
    )
    for (const [path, content] of node.files) expect(JSON.stringify(browser.files[path]), path).toBe(JSON.stringify(content))
    expect(Object.keys(browser.files).sort()).toEqual([...node.files.map(([p]) => p), 'manifest.json'].sort())
    // 範例有構詞：自動派生圖不是空的（kan → makan、pakan…）
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
    expect(a.files['manifest.json']).toMatchObject({ version: a.version, sources: ['playground'], counts: { records: 36 } })
  })

  it('進度：分析每一段都回報；步驟依序', async () => {
    const steps: string[] = []
    const progress: number[] = []
    await buildProject(SAMPLE, { sha1Hex, analyze: analyzeInProcess((done) => progress.push(done)), onStep: (s) => steps.push(s) })
    expect(steps).toEqual(['dataset', 'index', 'derivations', 'done'])
    expect(progress.at(-1)).toBe(SAMPLE.words.length + 2) // 詞圖的詞數（含例句中的詞）
  })
})

describe('站台設定', () => {
  it('名稱、變體、語言設定檔、範例、實驗室的詞對來自專案；介面字串沿用建置時的設定', () => {
    const site = playgroundClientSite(SITE, SAMPLE)
    expect(site.title).toEqual({ 'zh-TW': '示範語（範例專案）', en: 'Demo language (sample project)' })
    expect(site.varieties.map((v) => [v.code, v.parent])).toEqual([
      ['north', null],
      ['south', null],
      ['coast', 'south'],
    ])
    expect(site.profile).toBe(SAMPLE.profile)
    expect(site.examples[0].q).toBe('ralan')
    expect(site.lab.pairs[0]).toEqual(['ralan', 'lalan'])
    expect(site.lab.morph.examples[0]).toEqual(['pakan', 'kan'])
    expect(site).toMatchObject({ playground: true, csr: false, messages: SITE.messages, locales: SITE.locales })
  })

  it('沒有範例時以前幾個詞當範例、前兩個詞當實驗室的詞對；沒有構詞時沒有構詞例子', () => {
    const p = { ...clone(SAMPLE), examples: undefined, lab: undefined }
    delete p.profile.morphology
    const site = playgroundClientSite(SITE, p)
    expect(site.examples.map((e) => e.q)).toEqual(['ralan', 'lalan', 'bunan'])
    expect(site.lab.pairs).toEqual([['ralan', 'lalan']])
    expect(site.lab.morph.examples).toEqual([])
  })
})

describe('網站起始包與 zip', () => {
  it('站台設定、語言設定檔與資料集（與 writeDataset 相同的格式）', async () => {
    const files = new Map(siteStarterFiles(SAMPLE, 'demo-dict'))
    expect([...files.keys()]).toEqual(['README.md', 'babizu.config.js', 'language.json', 'data/records/playground/words.json', 'data/records/playground/sentences.json', 'data/sources.json', 'data/dataset.json'])
    expect(files.get('babizu.config.js')).toContain('id: "demo-dict"')
    expect(files.get('babizu.config.js')).toContain('"code": "coast"')
    expect(JSON.parse(files.get('language.json') as string)).toEqual(SAMPLE.profile)
    expect(JSON.parse(files.get('data/dataset.json') as string)).toMatchObject({ format: 'babizu-dataset', sources: [{ id: 'playground' }] })
    const zip = createZip([...files])
    const back = await unzipText(zip)
    expect([...back]).toEqual([...files])
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

describe('讀 .xlsx', () => {
  /** 一個最小的活頁簿；deflate 為 true 時以 deflate 壓縮（Excel 存檔的方式） */
  function workbook(deflate: boolean): Uint8Array {
    const files: Array<[string, string]> = [
      ['xl/workbook.xml', '<workbook><sheets><sheet name="詞表" sheetId="1" r:id="rId7"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/data.xml"/></Relationships>'],
      ['xl/sharedStrings.xml', '<sst><si><t>詞</t></si><si><t>中文</t></si><si><r><t>ra</t></r><r><t>lan</t></r></si><si><t xml:space="preserve"> 路 &amp; 道 </t></si></sst>'],
      [
        'xl/worksheets/data.xml',
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>tulu</t></is></c><c r="B3"><v>3</v></c></row>' +
          '<row r="4"><c r="A4"/></row></sheetData></worksheet>',
      ],
    ]
    if (!deflate) return createZip(files)
    // 以 deflate 壓縮的 zip（只寫 readXlsx 需要的欄位）
    const enc = new TextEncoder()
    const parts: number[] = []
    const central: number[] = []
    const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff]
    const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
    for (const [name, text] of files) {
      const data = [...deflateRawSync(enc.encode(text))]
      const nameBytes = [...enc.encode(name)]
      const offset = parts.length
      parts.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(8), ...u32(0), ...u32(0), ...u32(data.length), ...u32(text.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes, ...data)
      central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(8), ...u32(0), ...u32(0), ...u32(data.length), ...u32(text.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes)
    }
    const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(central.length), ...u32(parts.length), ...u16(0)]
    return new Uint8Array([...parts, ...central, ...end])
  }

  for (const deflate of [false, true]) {
    it(`第一張工作表（依 workbook 與 rels 找到）：共用字串、格式化片段、行內字串、數字、跳過的欄、空白列（${deflate ? 'deflate' : '不壓縮'}）`, async () => {
      expect(await readXlsx(workbook(deflate))).toEqual([
        ['詞', '中文'],
        ['ralan', '', '路 & 道'],
        ['tulu', '3'],
      ])
    })
  }
})
