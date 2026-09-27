/**
 * @file 前端單元測試用的 `virtual:babizu/site`（實際建置時由 src/site/vite.js 產生）。
 * 用巴宰–噶哈巫語的設定，因為它有從屬變體（愛蘭 ⊂ 巴宰）與真實的規則表。
 */

import en from '../../locales/en.json' with { type: 'json' }
import PAZEH_PROFILE from './pazeh-kaxabu.profile.json' with { type: 'json' }

export default {
  id: 'test-site',
  locales: ['zh-TW', 'en'],
  defaultLocale: 'zh-TW',
  localeNames: { 'zh-TW': '中文', en: 'English' },
  title: { 'zh-TW': '測試辭典', en: 'Test Dictionary' },
  shortTitle: { 'zh-TW': '測試', en: 'Test' },
  description: null,
  footer: null,
  icon: null,
  themeColor: '#000000',
  varieties: [
    { code: 'pazeh', parent: null, label: { 'zh-TW': '巴宰', en: 'Pazeh' }, colors: {} },
    { code: 'kaxabu', parent: null, label: { 'zh-TW': '噶哈巫', en: 'Kaxabu' }, colors: {} },
    { code: 'auran', parent: 'pazeh', label: { 'zh-TW': '巴宰（愛蘭）', en: 'Pazeh (Auran)' }, colors: {} },
  ],
  writingSystems: { 'pan-yongli': { 'zh-TW': '潘永歷標記法', en: 'Pan Yong-li orthography' } },
  specialChars: ['é'],
  examples: [],
  about: null,
  lab: { pairs: [['semer', 'semee']], words: null, morph: { examples: [], failures: [] } },
  // 中文是原文語系（程式裡直接寫中文），不需要譯文表
  messages: { 'zh-TW': {}, en },
  profile: PAZEH_PROFILE,
}
