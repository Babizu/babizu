/**
 * 展示版的 CSV 匯入（src/playground/tabular.ts）：各種試算表軟體、作業系統、編碼存出來的 CSV 都要讀成同一份表格，
 * 再對應欄首、轉成專案的詞（含詞根），經過搜尋索引之後查詞根找得到衍生詞。
 *
 * 做法：同一份有「陷阱」的內容（逗號、引號、換行、空格、空欄、組合用字元），以幾十種方式序列化，逐一讀回來比對。
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildSearchIndex, SearchEngine } from '../../src/search/index.ts'
import { projectToDataset, type PlaygroundProject, type ProjectWord } from '../../src/playground/project.ts'
import { decodeText, guessRoles, parseTable, tableToSentences, tableToWords, TableError, type ColumnRole } from '../../src/playground/tabular.ts'

const SAMPLE: PlaygroundProject = JSON.parse(readFileSync(new URL('../../examples/playground/sample-project.json', import.meta.url), 'utf8'))

// ───────────────────────── 序列化（模擬各種軟體存出的 CSV） ─────────────────────────

type Table = string[][]

/** 依 RFC 4180 寫出一格：含分隔符號、引號、換行或前後空白時用引號包起來 */
function quoteCell(cell: string, delimiter: string, always = false): string {
  return always || /["\r\n]/u.test(cell) || cell.includes(delimiter) || cell !== cell.trim() ? `"${cell.replace(/"/gu, '""')}"` : cell
}

interface Style {
  delimiter?: string
  /** 列與列之間；格子裡的換行也換成這個（Excel 在 Windows 存的檔，格子裡的換行是 LF，列尾是 CRLF） */
  eol?: string
  bom?: boolean
  trailingEol?: boolean
  alwaysQuote?: boolean
}

function toCsv(table: Table, { delimiter = ',', eol = '\r\n', bom = false, trailingEol = true, alwaysQuote = false }: Style = {}): string {
  const body = table.map((row) => row.map((c) => quoteCell(c, delimiter, alwaysQuote)).join(delimiter)).join(eol)
  return `${bom ? '﻿' : ''}${body}${trailingEol ? eol : ''}`
}

const utf8 = (text: string) => new TextEncoder().encode(text)
function utf16(text: string, order: 'le' | 'be', bom = true): Uint8Array {
  const out: number[] = bom ? (order === 'le' ? [0xff, 0xfe] : [0xfe, 0xff]) : []
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    out.push(...(order === 'le' ? [c & 0xff, c >> 8] : [c >> 8, c & 0xff]))
  }
  return new Uint8Array(out)
}
/** Big5 編碼：用 TextDecoder 的對照表反推（Node 沒有 Big5 編碼器） */
const BIG5 = (() => {
  const map = new Map<string, number[]>()
  const decoder = new TextDecoder('big5')
  for (let lead = 0xa1; lead <= 0xf9; lead++) {
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      const ch = decoder.decode(new Uint8Array([lead, trail]))
      if (ch.length === 1 && ch !== '�' && !map.has(ch)) map.set(ch, [lead, trail])
    }
  }
  return map
})()
function big5(text: string): Uint8Array {
  const out: number[] = []
  for (const ch of text) {
    if (ch.charCodeAt(0) < 0x80) out.push(ch.charCodeAt(0))
    else {
      const code = BIG5.get(ch)
      if (!code) throw new Error(`Big5 沒有「${ch}」`)
      out.push(...code)
    }
  }
  return new Uint8Array(out)
}

/** 檔案 → 表格（匯入視窗做的事：解碼、剖析） */
const read = (bytes: Uint8Array) => parseTable(decodeText(bytes).text)

// ───────────────────────── 內容 ─────────────────────────

/** 有陷阱的內容：逗號、雙引號、格子裡的換行、空欄、前後空白（會被去掉）、組合用字元（NFC） */
const TRICKY: Table = [
  ['詞', '詞根', '中文', 'English', '方言', '備註'],
  ['kita, ita', 'kita', '看，見', 'see, look', 'pazeh', '逗號在格子裡'],
  ['ra"lan', '', '路', 'road', 'kaxabu', '引號在格子中間'],
  ['"quoted"', 'quote', '"引號"整個包住', 'say "hi"', 'pazeh、kaxabu', '兩個方言'],
  ['two\nlines', '', '第一行\n第二行', 'a\nb', '', '格子裡的換行'],
  ['空欄', '', '', '', '', ''],
  ['tutu', 'tu', '石頭', 'stone', 'pazeh', '最後一列'],
]
/** 讀回來的樣子：換行統一成 LF、前後空白去掉 */
const EXPECTED = TRICKY

describe('CSV 的各種寫法：讀回來都是同一份表格', () => {
  const eols = { 'CRLF（Windows）': '\r\n', 'LF（Mac、Linux）': '\n', 'CR（舊版 Mac）': '\r' }
  const delimiters = { 逗號: ',', 分號: ';', tab: '\t' }

  for (const [eolName, eol] of Object.entries(eols)) {
    for (const [delName, delimiter] of Object.entries(delimiters)) {
      for (const bom of [false, true]) {
        for (const trailingEol of [true, false]) {
          it(`${eolName}、${delName}分隔、${bom ? '有' : '沒有'} BOM、${trailingEol ? '有' : '沒有'}結尾換行`, () => {
            // 格子裡的換行與列尾是同一種（CR 的檔格子裡也是 CR）
            const table = TRICKY.map((row) => row.map((c) => c.replace(/\n/gu, eol)))
            const csv = toCsv(table, { delimiter, eol, bom, trailingEol })
            expect(read(utf8(csv))).toEqual(EXPECTED)
          })
        }
      }
    }
  }

  it('每一格都加引號（有些軟體的預設）', () => {
    expect(read(utf8(toCsv(TRICKY, { alwaysQuote: true })))).toEqual(EXPECTED)
  })

  it('Excel 在 Windows 存的檔：列尾 CRLF，格子裡的換行只有 LF', () => {
    expect(read(utf8(toCsv(TRICKY, { eol: '\r\n', bom: true })))).toEqual(EXPECTED)
  })

  it('同一個檔裡混著 CRLF、LF、CR', () => {
    expect(parseTable('a,b\r\nc,d\ne,f\rg,h')).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']])
  })

  it('UTF-16（Excel「Unicode 文字」）：LE、BE，有 BOM', () => {
    const csv = toCsv(TRICKY, { delimiter: '\t' })
    expect(decodeText(utf16(csv, 'le')).encoding).toBe('utf-16le')
    expect(read(utf16(csv, 'le'))).toEqual(EXPECTED)
    expect(decodeText(utf16(csv, 'be')).encoding).toBe('utf-16be')
    expect(read(utf16(csv, 'be'))).toEqual(EXPECTED)
  })

  it('Big5（中文版 Excel 另存 CSV 的預設）：中文與符號都讀對', () => {
    const csv = toCsv(TRICKY.map((row) => row.map((c) => c.replace(/，/gu, ',').replace(/、/gu, '、'))))
    const bytes = big5(csv)
    expect(decodeText(bytes).encoding).toBe('big5')
    expect(read(bytes)).toEqual(TRICKY.map((row) => row.map((c) => c.replace(/，/gu, ','))))
  })

  it('純 ASCII 的檔照 UTF-8 讀；UTF-8 與 Big5 的判斷不會把合法的 UTF-8 當成 Big5', () => {
    expect(decodeText(utf8('a,b\n1,2')).encoding).toBe('utf-8')
    expect(decodeText(utf8('詞,中文\n石頭,stone')).encoding).toBe('utf-8')
  })

  it('組合用字元（NFD）統一成 NFC；全形空白不被當成空白去掉', () => {
    expect(parseTable('é,x')[0]).toEqual(['é', 'x'])
    expect(parseTable('ａ　,b')[0][0]).toBe('ａ')
    // 前後的一般空白、tab 去掉（不管有沒有引號）
    expect(parseTable('"  a  ",  b  ')).toEqual([['a', 'b']])
  })

  it('空白列、只有分隔符號的列略過；各列欄數可以不同', () => {
    expect(parseTable('a,b,c\n\n,,\n  ,  ,\nd\ne,f,g,h\n\n\n')).toEqual([['a', 'b', 'c'], ['d'], ['e', 'f', 'g', 'h']])
  })

  it('空檔、只有空白或換行的檔 → 空表格', () => {
    expect(parseTable('')).toEqual([])
    expect(parseTable('﻿')).toEqual([])
    expect(parseTable('\r\n\r\n  \r\n')).toEqual([])
  })

  it('只有欄首', () => {
    expect(parseTable('詞,中文')).toEqual([['詞', '中文']])
  })
})

describe('CSV 讀不懂時：說明問題在哪裡', () => {
  it('引號沒有關上：指出是從第幾行開始的', () => {
    const err = (() => {
      try {
        parseTable('a,b\nc,d\ne,"f\ng,h\n')
      } catch (e) {
        return e as TableError
      }
    })()
    expect(err).toBeInstanceOf(TableError)
    expect(err?.line).toBe(3)
    expect(err?.message).toMatch(/^第 3 行：.*雙引號/u)
  })

  it('結束引號後面還有字（不規範的 CSV）：整格原樣保留，連引號一起，不丟字也不整檔讀不進來', () => {
    expect(parseTable('a,"b"c,d')).toEqual([['a', '"b"c', 'd']])
    expect(parseTable('a,x"y"z,d')).toEqual([['a', 'x"y"z', 'd']])
  })

  it('Excel（.xlsx、zip）不是 CSV：說明要另存成 CSV', () => {
    expect(() => decodeText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toThrow(/CSV UTF-8/u)
  })

  it('不是文字的檔（隨機的位元組）：說明編碼無法判斷，或當成亂碼之前就說清楚', () => {
    // 0x81 0x20：不是合法的 UTF-8，也不是合法的 Big5
    expect(() => decodeText(new Uint8Array([0x81, 0x20, 0x81, 0x20]))).toThrow(TableError)
  })

  it('引號出現在格子中間（5" 螺絲）照原樣保留', () => {
    expect(parseTable('5" pipe,x')).toEqual([['5" pipe', 'x']])
  })
})

describe('分隔符號判斷', () => {
  const cases: Array<[string, string]> = [
    ['詞,中文,英文', ','],
    ['詞;中文;英文', ';'],
    ['詞\t中文\t英文', '\t'],
    ['"a,b,c";d;e', ';'],
    ['"a;b;c",d,e', ','],
    ['詞,中文;英文,方言', ','],
  ]
  for (const [text, expected] of cases) {
    it(`${JSON.stringify(text)} → ${JSON.stringify(expected)}`, () => {
      expect(parseTable(`${text}\nx${expected}y${expected}z`)[0].length).toBeGreaterThan(1)
    })
  }

  it('逗號分隔、小數點是逗號的歐洲格式（分號分隔）', () => {
    expect(parseTable('詞;數量\nabc;1,5')).toEqual([['詞', '數量'], ['abc', '1,5']])
  })
})

describe('欄首對應（含詞根）', () => {
  it('中英文、大小寫、空白與底線不計', () => {
    expect(guessRoles(['詞根'])).toEqual(['root'])
    for (const h of ['Root', 'ROOT', 'root word', 'Root_Word', 'stem', 'Base Form', 'derived from', '衍生自', '字根', '語根']) {
      expect(guessRoles(['詞', h]), h).toEqual(['text', 'root'])
    }
  })

  it('詞與詞根欄首相近時不混淆：「詞」→ 詞形，「詞根」→ 詞根', () => {
    expect(guessRoles(['詞根', '詞'])).toEqual(['root', 'text'])
    expect(guessRoles(['Lemma', 'Root', 'Gloss'], [['a', 'b', 'road']])).toEqual(['text', 'root', 'en'])
  })

  it('兩欄都叫詞根：只取第一欄', () => {
    expect(guessRoles(['詞', '詞根', '字根'])).toEqual(['text', 'root', 'ignore'])
  })

  it('記住的對應可以把詞根改派給別的欄首', () => {
    expect(guessRoles(['詞', 'Origin'], [], { origin: 'root' })).toEqual(['text', 'root'])
  })
})

describe('CSV → 專案的詞（含詞根）', () => {
  const VARIETIES = [
    { code: 'pazeh', label: { 'zh-TW': '巴宰' } },
    { code: 'kaxabu', label: { 'zh-TW': '噶哈巫' } },
  ]
  const table = read(utf8(toCsv(TRICKY, { bom: true })))
  const roles = guessRoles(table[0], table.slice(1))

  it('欄首自動對應；詞根、中英文、方言、備註各歸各欄', () => {
    expect(roles).toEqual(['text', 'root', 'zh', 'en', 'dialect', 'note'])
    const { rows, skippedRows, unknownDialects } = tableToWords(table, roles, { hasHeader: true, varieties: VARIETIES })
    expect(skippedRows).toEqual([])
    expect(unknownDialects).toEqual([])
    expect(rows.map((r) => r.id)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6'])
    expect(rows[0]).toEqual({ id: 'w1', text: 'kita, ita', root: 'kita', zh: '看，見', en: 'see, look', dialects: ['pazeh'], pos: '', alt: [], note: '逗號在格子裡' })
    expect(rows[2]).toMatchObject({ text: '"quoted"', root: 'quote', zh: '"引號"整個包住', dialects: ['pazeh', 'kaxabu'] })
    expect(rows[3]).toMatchObject({ text: 'two\nlines', root: '', zh: '第一行\n第二行' })
    expect(rows[4]).toEqual({ id: 'w5', text: '空欄', root: '', zh: '', en: '', dialects: [], pos: '', alt: [], note: '' })
  })

  it('沒有詞根欄時，詞根是空字串', () => {
    const noRoot = table.map((r) => r.filter((_, k) => k !== 1))
    const r = tableToWords(noRoot, guessRoles(noRoot[0]), { hasHeader: true, varieties: VARIETIES })
    expect(r.rows.every((w) => w.root === '')).toBe(true)
  })

  it('詞根相同、詞形相同但詞根不同，算不同的列（略過重複時不誤刪）', () => {
    const t = [['詞', '詞根'], ['a', 'x'], ['a', 'y'], ['a', 'x']]
    const r = tableToWords(t, ['text', 'root'], { hasHeader: true, varieties: [], skipDuplicates: true })
    expect(r.rows.map((w) => w.root)).toEqual(['x', 'y'])
    expect(r.duplicateRows).toEqual([4])
  })

  it('例句不用詞根欄：對到詞根的欄被忽略', () => {
    const r = tableToSentences([['句', '詞根']], ['text', 'root'], { hasHeader: false, varieties: [] })
    expect(r.rows[0]).toEqual({ id: 's1', text: '句', zh: '', en: '', dialects: [], note: '' })
  })

  it('範例專案的詞表匯出成 CSV 再匯入：每一欄都相同（加上詞根）', () => {
    const words: ProjectWord[] = SAMPLE.words.map((w, k) => ({ ...w, root: k % 3 === 0 ? `root${k}` : '' }))
    const header = ['詞', '詞根', '中文', '英文', '方言', '詞類', '其他寫法', '備註']
    const label = (code: string) => SAMPLE.varieties.find((v) => v.code === code)?.label
    const text = (v: unknown) => (typeof v === 'string' ? v : (v as Record<string, string>)['zh-TW'])
    const rows = words.map((w) => [w.text, w.root ?? '', w.zh, w.en, w.dialects.map((d) => text(label(d))).join('、'), w.pos, w.alt.join(', '), w.note])
    // 以三種寫法各存一次
    for (const bytes of [utf8(toCsv([header, ...rows], { bom: true })), utf8(toCsv([header, ...rows], { eol: '\n' })), utf16(toCsv([header, ...rows], { delimiter: '\t' }), 'le')]) {
      const back = read(bytes)
      expect(back).toHaveLength(words.length + 1)
      const r = tableToWords(back, guessRoles(back[0], back.slice(1)), { hasHeader: true, varieties: SAMPLE.varieties })
      expect(r.unknownDialects).toEqual([])
      expect(r.skippedRows).toEqual([])
      expect(r.rows.map(({ id: _id, ...rest }) => rest)).toEqual(words.map(({ id: _id, ...rest }) => ({ ...rest, root: rest.root ?? '', note: rest.note ?? '' })))
    }
  })

  it('兩萬列的檔：讀得完，列數正確', () => {
    const big: Table = [['詞', '詞根', '中文']]
    for (let k = 0; k < 20000; k++) big.push([`word${k}`, k % 2 ? `root${k}` : '', `意思 ${k}, "引號" ${k}`])
    const started = Date.now()
    const back = read(utf8(toCsv(big)))
    expect(back).toHaveLength(20001)
    expect(back[20000]).toEqual(['word19999', 'root19999', '意思 19999, "引號" 19999'])
    expect(Date.now() - started).toBeLessThan(5000)
  })
})

describe('詞根 → 資料集與搜尋', () => {
  const project: PlaygroundProject = {
    ...SAMPLE,
    varieties: [],
    words: [
      { id: 'w1', text: 'baket', root: '', zh: '', en: '', dialects: [], pos: '', alt: [], note: '' },
      { id: 'w2', text: 'mubaket', root: ' baket ', zh: '', en: '', dialects: [], pos: '', alt: [], note: '' },
      { id: 'w3', text: 'minubaket', root: 'baket', zh: '', en: '', dialects: [], pos: '', alt: [], note: '' },
      { id: 'w4', text: 'alaw', zh: '', en: '', dialects: [], pos: '', alt: [], note: '' },
    ],
    sentences: [],
  }
  const [{ shards }] = projectToDataset(project)
  const records = shards[0].records

  it('詞根成為記錄的 morphology.derivedFrom（前後空白去掉）；沒有詞根的記錄沒有構詞資訊', () => {
    expect(records[1].morphology).toEqual({ formType: null, segmentation: null, gloss: null, derivedFrom: [{ relation: '<', text: 'baket' }] })
    expect(records[0].morphology).toBeNull()
    expect(records[3].morphology).toBeNull()
  })

  it('舊的專案檔沒有 root 欄位也能轉換', () => {
    expect(records[3].text).toBe('alaw')
  })

  it('查詞根：詞根本身與標了這個詞根的詞都找得到，沒標的不會', () => {
    const data = JSON.parse(JSON.stringify(buildSearchIndex({ items: records.map((record) => ({ record, shard: 'words' })), groups: [], sourceIds: ['playground'], profile: project.profile })))
    const engine = new SearchEngine(data)
    const ids = engine.search('baket', { fields: ['native'], fuzziness: 'exact' }).entries.map((h) => h.doc.id)
    expect(ids).toEqual(expect.arrayContaining(['playground:w1', 'playground:w2', 'playground:w3']))
    expect(ids).not.toContain('playground:w4')
    // 只有詞根這一層連到的詞，標示是「詞根」而不是詞形本身
    const derived = engine.search('baket', { fields: ['native'], fuzziness: 'exact' }).entries.find((h) => h.doc.id === 'playground:w2')
    expect(derived?.matchType).not.toBe('head')
  })
})

describe('使用者的整份流程：不同欄首的 CSV 都能匯進來', () => {
  const FILES: Array<[string, string, ColumnRole[]]> = [
    ['英文欄首、gloss 是英文', 'Word,Root,Gloss,Dialect\nkita,kita,see,pazeh\n', ['text', 'root', 'en', 'dialect']],
    ['中文欄首、釋義是中文', '詞,詞根,釋義,方言\nkita,kit,看見,pazeh\n', ['text', 'root', 'zh', 'dialect']],
    ['語言學家的欄首', 'Lexeme\tStem\tMeaning\tDoculect\nkita\tkit\tsee\tpazeh\n', ['text', 'root', 'en', 'dialect']],
    ['沒有表頭：第一欄是詞形，其他不用', 'kita,kit\nbatu,bat\n', ['text', 'ignore']],
  ]
  for (const [name, csv, expectedRoles] of FILES) {
    it(name, () => {
      const t = parseTable(csv)
      const header = guessRoles(t[0], t.slice(1))
      const hasHeader = header.some((r) => r !== 'ignore')
      const roles = hasHeader ? header : (t[0].map((_, k) => (k === 0 ? 'text' : 'ignore')) as ColumnRole[])
      expect(roles).toEqual(expectedRoles)
      const r = tableToWords(t, roles, { hasHeader, varieties: [{ code: 'pazeh', label: 'pazeh' }] })
      expect(r.rows.length).toBe(hasHeader ? t.length - 1 : t.length)
      expect(r.rows[0].text).toBe('kita')
      if (expectedRoles.includes('root')) expect(r.rows[0].root).toBeTruthy()
    })
  }
})
