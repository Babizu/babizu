# 建立一個辭典網站

以下從零開始建立一個網站。完整的可執行版本在 [examples/minimal/](../examples/minimal/)。

需要 Node.js 20.19 以上。

## 1. 建立站台目錄

```bash
mkdir my-dictionary && cd my-dictionary
npm init -y
npm pkg set type=module
npm install github:Babizu/babizu#v0.1.0
```

## 2. 語言設定檔 `language.json`

先從最少的規則開始，之後再依方言對應逐步補上（見 [language-profile.md](language-profile.md)）：

```json
{
  "format": "babizu-language-profile",
  "version": 1,
  "normalizer": { "lowercase": true, "stripDiacritics": true },
  "costs": { "substitute": 1.5, "delete": 1, "insert": 0.8, "overrides": { " ": { "substitute": 0.1, "delete": 0.1, "insert": 0.1 } } },
  "rules": [{ "category": "流音", "label": { "en": "Liquids" }, "rules": [["r", "l", 0.1]] }]
}
```

## 3. 站台設定 `babizu.config.js`

```js
import { defineSite } from 'babizu'

export default defineSite({
  id: 'my-dictionary',
  locales: ['zh-TW', 'en'],
  title: { 'zh-TW': '某某語辭典', en: 'Some Language Dictionary' },
  language: 'language.json',
  varieties: [
    { code: 'north', label: { 'zh-TW': '北部', en: 'Northern' } },
    { code: 'south', label: { 'zh-TW': '南部', en: 'Southern' } },
  ],
})
```

所有欄位見 [site-config.md](site-config.md)。

## 4. 產生資料集

寫一個轉接器把原始資料轉成標準格式，再用 `exportDataset` 寫到 `data/`（見 [adapters.md](adapters.md)）：

```bash
npm install read-excel-file   # 依原始資料的格式安裝需要的解析套件
node export.mjs
```

## 5. 開發與建置

```bash
npx babizu check     # 檢查設定、語言設定檔、資料集
npx babizu dev       # 開發伺服器
npx babizu build     # 建置到 dist/
npx babizu preview   # 預覽建置結果
```

在 `.gitignore` 加上 `node_modules/`、`dist/`、`.babizu/`。

## 6. 補上內容

- 「關於」頁：`content/about.zh-TW.md`、`content/about.en.md`，在設定的 `about` 指定
- 站徽：`public/icon.jpg`
- 首頁範例查詢：`examples`
- 演算法實驗室的示範詞對：`lab.pairs`
- 其他介面語系：`locales/<語系>.json`（見 [i18n.md](i18n.md)）

## 7. 部署

見 [deployment.md](deployment.md)。
