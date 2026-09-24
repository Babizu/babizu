# 站台設定 `babizu.config.js`

每個網站的根目錄放一個 `babizu.config.js`，預設匯出 `defineSite({...})`。
`babizu check` 會檢查設定、語言設定檔與資料集；有錯誤時 `build`／`dev` 會列出錯誤並停止。

```
my-dictionary/
├── babizu.config.js
├── language.json          語言設定檔（見 language-profile.md）
├── data/                  資料集（見 data-format.md）
├── content/               「關於」頁的 Markdown，依語系分檔
├── locales/               介面字串覆寫與額外語系（見 i18n.md）
└── public/                站徽等靜態檔
```

## 範例

```js
import { defineSite } from 'babizu'

export default defineSite({
  id: 'my-dictionary',
  locales: ['zh-TW', 'en'],
  title: { 'zh-TW': '某某語辭典', en: 'Some Language Dictionary' },
  shortTitle: { 'zh-TW': '某某語', en: 'Some Language' },
  description: { 'zh-TW': '…', en: '…' },
  language: 'language.json',
  varieties: [
    { code: 'north', label: { 'zh-TW': '北部', en: 'Northern' }, hue: 265 },
    { code: 'south', label: { 'zh-TW': '南部', en: 'Southern' }, hue: 150 },
    { code: 'coast', parent: 'south', label: { 'zh-TW': '南部（海岸）', en: 'Southern (coastal)' } },
  ],
  specialChars: ['ʔ'],
  examples: [{ q: 'ralan', note: { 'zh-TW': '也會找到 lalan', en: 'also finds lalan' } }],
  about: { 'zh-TW': 'content/about.zh-TW.md', en: 'content/about.en.md' },
  lab: { pairs: [['ralan', 'lalan']] },
})
```

完整的可執行範例：[examples/minimal/](../examples/minimal/)。

## 依語系提供的文字（Localized）

標為 *Localized* 的欄位可以是字串（所有語系共用），或 `{ 語系: 文字 }`。
缺少的語系用預設語系的文字。

## 欄位

| 欄位 | 型別 | 預設 | 說明 |
|---|---|---|---|
| `id` | string | **必填** | 站台代號（小寫英數與連字號）。瀏覽器儲存空間的前綴，同一個網域放多個辭典時不會互相干擾 |
| `locales` | string[] | `['zh-TW']` | 介面語系。框架內建 `zh-TW`、`en`；其他語系在 `locales/` 提供字串（見 [i18n.md](i18n.md)） |
| `defaultLocale` | string | `locales[0]` | 預設語系；缺字時回退到這裡 |
| `localeNames` | `{語系: 名稱}` | 內建語系已有名稱 | 語系選單上的顯示名稱 |
| `title` | Localized | **必填** | 網站名稱 |
| `shortTitle` | Localized | `title` | 窄螢幕用的短名稱 |
| `description` | Localized | — | 首頁說明與 `<meta name="description">` |
| `language` | string | `language.json` | 語言設定檔路徑 |
| `data` | string | `data` | 資料集目錄 |
| `publicDir` | string | `public` | 靜態檔目錄，內容原樣複製到網站根目錄 |
| `icon` | string | `icon.jpg` | 站徽（相對 `publicDir`）；檔案不存在時不顯示 |
| `themeColor` | string | `#2f3f7a` | 行動瀏覽器網址列顏色 |
| `varieties` | Variety[] | `[]` | 語言變體（方言），見下節 |
| `writingSystems` | `{代碼: Localized}` | `{}` | 記錄 `altTexts[].system` 的顯示名稱，例如 `{ 'pan-yongli': '潘永歷標記法' }` |
| `specialChars` | string[] | `[]` | 搜尋框旁的特殊字元快捷鍵（一般鍵盤打不出來的字母） |
| `examples` | `{q, note?}[]` | `[]` | 首頁的範例查詢；`note` 是 Localized |
| `about` | Localized（路徑） | — | 「關於」頁的 Markdown 檔，見下節 |
| `footer` | Localized | 網站名稱＋引用提醒 | 頁尾文字 |
| `lab.pairs` | `[string, string][]` | `[]` | 演算法實驗室可以一鍵帶入的詞對，第一組是預設值；第一組也會出現在「關於」頁的特色介紹 |
| `lab.words` | string | 由 `lab.pairs` 組成 | 詞圖示範的詞庫（以空白分隔） |
| `messages` | string | `locales` | 介面字串目錄 |

## 語言變體 `varieties`

| 欄位 | 說明 |
|---|---|
| `code` | 代碼（小寫英數與連字號）。記錄的 `dialects` 欄位只能使用這裡列出的代碼，匯出與建置時會檢查 |
| `label` | Localized 顯示名稱 |
| `parent` | 所屬的上層變體。**篩選上層時一併納入下層**（例如篩「南部」也會列出「南部（海岸）」），反之則否 |
| `hue` | 色相（0–360）。未指定時：最上層依序分配（55、175、265、330…），下層沿用最上層祖先的色相 |
| `colors` | `{ light: {fg, bg}, dark: {fg, bg} }` 直接指定 CSS 色值，優先於 `hue` |

顏色由色相以 OKLCH 產生淺色與深色兩組；下層變體自動降低彩度，看得出是同一系。
每個變體會產生 `.variety-<code>` CSS class，「關於」頁的 Markdown 可以用
`<span class="variety-badge variety-north">北部</span>` 顯示和全站一致的徽章。

- 最多 31 種變體（搜尋索引以位元遮罩儲存）。
- 清單順序就是篩選面板與徽章的順序；下層變體會自動排在上層後面。
- 沒有方言區分的語言可以不設定 `varieties`，篩選面板就不顯示方言。

## 「關於」頁 `about`

Markdown，建置時轉成 HTML，接在框架內建的特色介紹後面。可以依語系分檔：

```js
about: { 'zh-TW': 'content/about.zh-TW.md', en: 'content/about.en.md' }
```

內容中可以使用：

- `## 標題`、清單、表格、`code` 等一般 Markdown
- `[資料來源](#/sources)`、`[演算法實驗室](#/lab)` 這類站內連結（hash 路由，不會重新載入頁面）
- `<span class="variety-badge variety-<代碼>">名稱</span>` 方言徽章
- `<span class="native-text">…</span>` 以目標語言的字體顯示

Markdown 來自站台自己的 repo，視為可信任的內容，不做 HTML 過濾。

## 指令

在站台目錄執行（或把站台目錄當第一個參數）：

| 指令 | 說明 |
|---|---|
| `babizu dev [--port 5173]` | 開發伺服器，修改框架或設定會即時更新 |
| `babizu build` | 建置到 `dist/` |
| `babizu preview [--port 4173]` | 預覽建置結果 |
| `babizu check` | 只檢查設定、語言設定檔與資料集 |
| `babizu locales` | 列出各語系缺少的介面字串 |

建置的中間產物在 `.babizu/`（請加進 `.gitignore`）。
