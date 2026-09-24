/**
 * 示範站台：一個虛構的小語言，用來展示框架的所有設定欄位，也是框架自己的端對端測試對象。
 * 建置：npm run example:build（在框架根目錄）
 */

import { defineSite } from '../../src/index.js'

export default defineSite({
  id: 'babizu-demo',
  locales: ['zh-TW', 'en'],
  title: { 'zh-TW': 'Babizu 示範辭典', en: 'Babizu Demo Dictionary' },
  shortTitle: { 'zh-TW': '示範辭典', en: 'Demo' },
  description: {
    'zh-TW': '用虛構的小語言展示 Babizu 框架：跨方言模糊搜尋、出處溯源、多語系介面。',
    en: 'A made-up language showing off the Babizu framework: cross-dialect fuzzy search, provenance and a multilingual interface.',
  },
  language: 'language.json',
  data: 'data',
  varieties: [
    { code: 'north', label: { 'zh-TW': '北部', en: 'Northern' }, hue: 265 },
    { code: 'south', label: { 'zh-TW': '南部', en: 'Southern' }, hue: 150 },
    // 海岸腔是南部的地方變體：篩選「南部」時一併出現，顏色也沿用南部的色相
    { code: 'coast', parent: 'south', label: { 'zh-TW': '南部（海岸）', en: 'Southern (coastal)' } },
  ],
  specialChars: ['ʔ'],
  examples: [
    { q: 'ralan', note: { 'zh-TW': '也會找到南部的 lalan（r↔l）', en: 'also finds southern lalan (r↔l)' } },
    { q: 'bunan', note: { 'zh-TW': '也會找到 bunang（詞尾 n↔ng）', en: 'also finds bunang (final n↔ng)' } },
    { q: '火', note: { 'zh-TW': '以中文釋義搜尋', en: 'search Chinese meanings' } },
    { q: 'water', note: { 'zh-TW': '以英文釋義搜尋', en: 'search English meanings' } },
  ],
  about: { 'zh-TW': 'content/about.zh-TW.md', en: 'content/about.en.md' },
  lab: {
    pairs: [
      ['ralan', 'lalan'],
      ['bunan', 'bunang'],
      ['tamoh', 'tamo'],
    ],
    words: 'ralan lalan bunan bunang tamoh tamo keru kilu sapi arem alim',
  },
})
