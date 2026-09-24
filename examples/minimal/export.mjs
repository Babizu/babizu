/**
 * @file 產生示範站台的資料集（虛構的「示範語」，只用來展示與測試框架）。
 *
 * 真實的網站會把原始資料（試算表、辭典 JSON、字幕…）交給轉接器；
 * 這裡的轉接器直接在程式裡產生記錄，示範 defineAdapter 與 exportDataset 的用法。
 *
 * 執行：node examples/minimal/export.mjs
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineAdapter, exportDataset } from '../../src/pipeline/index.js'
import { createCitation, createGroup, createRecord, createSense } from '../../src/schema/index.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))

/** 北部與南部兩種方言，海岸腔是南部的地方變體 */
const WORDS = [
  // [詞形, 中文, 英文, 方言]
  ['ralan', '路', 'road', 'north'],
  ['lalan', '路', 'road', 'south'],
  ['bunan', '月亮', 'moon', 'north'],
  ['bunang', '月亮', 'moon', 'south'],
  ['tamoh', '水', 'water', 'north'],
  ['tamo', '水', 'water', 'coast'],
  ['keru', '石頭', 'stone', 'north'],
  ['kilu', '石頭', 'stone', 'south'],
  ['sapiʔ', '火', 'fire', 'north'],
  ['sapi', '火', 'fire', 'south'],
  ['arem', '夜晚', 'night', 'north'],
  ['alim', '夜晚', 'night', 'coast'],
  ['ma-ruza', '跑', 'to run', 'north'],
  ['ma-luza', '跑', 'to run', 'south'],
  ['tuxan', '雨', 'rain', null],
]

const SENTENCES = [
  ['ma-ruza a tamoh', '水在流', 'The water flows.', 'north'],
  ['sapi ka alim', '夜晚的火', 'A fire at night.', 'coast'],
  ['bunang ka lalan!', '路上有月亮！', 'The moon is over the road!', 'south'],
]

const SOURCE_ID = 'demo-wordlist'

const demo = defineAdapter({
  source: {
    id: SOURCE_ID,
    title: '示範詞表',
    shortTitle: '示範詞表',
    type: 'wordlist',
    description: '為了展示框架而虛構的小詞表：兩種方言與一種地方變體，附幾個例句。',
    authors: [],
    year: null,
    publisher: null,
    citation: null,
    url: null,
    license: 'CC0-1.0',
    defaultDialects: [],
    orthography: '示範用的拉丁字母拼寫',
    browse: { mode: 'list', shardLabel: '部分' },
    reviewTracked: false,
    notes: ['內容全部是虛構的，只用來測試與示範。'],
  },
  async load() {
    const words = createGroup({ source: SOURCE_ID, localId: 'words', type: 'list', title: '詞' })
    const sentences = createGroup({ source: SOURCE_ID, localId: 'sentences', type: 'list', title: '例句' })
    const record = (/** @type {string} */ localId, /** @type {any[]} */ row, /** @type {any} */ group, unit, seq) =>
      createRecord(
        {
          source: SOURCE_ID,
          localId,
          unit,
          text: row[0],
          citation: createCitation(`示範詞表 ${localId}`, { code: localId }),
        },
        {
          senses: [createSense({ zh: row[1], en: row[2] })],
          dialects: row[3] ? [row[3]] : [],
          group: { id: group.id, role: 'item', parent: null, seq },
        },
      )
    return {
      shards: [
        { key: 'words', label: '詞', groups: [words], records: WORDS.map((w, k) => record(`w${k + 1}`, w, words, 'word', k)) },
        {
          key: 'sentences',
          label: '例句',
          groups: [sentences],
          records: SENTENCES.map((s, k) => record(`s${k + 1}`, s, sentences, 'sentence', k)),
        },
      ],
      assets: [],
    }
  },
})

const { ok } = await exportDataset({
  sources: [{ adapter: demo, input: '.' }],
  root: HERE,
  outDir: join(HERE, 'data'),
  dialects: ['north', 'south', 'coast'],
})
process.exitCode = ok ? 0 : 1
