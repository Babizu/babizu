/**
 * 展示版（docs/playground.md）：在瀏覽器裡上傳、編輯詞表與規則，即時建置成一部辭典，並查看 BCDP 怎麼運作。
 * 和語言無關；資料只存在讀者自己的瀏覽器裡。第一次開啟時載入範例專案（虛構的示範語）。
 *
 * 開發：npm run playground；建置：npm run playground:build（在框架根目錄）
 */

import { defineSite } from 'babizu'

export default defineSite({
  id: 'babizu-playground',
  locales: ['zh-TW', 'en'],
  title: { 'zh-TW': 'Babizu 展示版', en: 'Babizu Playground' },
  shortTitle: { 'zh-TW': '展示版', en: 'Playground' },
  description: {
    'zh-TW': '在瀏覽器裡上傳、編輯詞表與方言規則，即時建置成可以跨方言模糊搜尋的辭典，並查看演算法怎麼運作。',
    en: 'Upload or edit a wordlist and dialect rules in your browser, build a dictionary with cross-dialect fuzzy search on the fly, and see how the algorithm works.',
  },
  playground: { sample: 'sample-project.json' },
  about: { 'zh-TW': 'content/about.zh-TW.md', en: 'content/about.en.md' },
})
