# Babizu

多語言、可溯源的**辭典網站框架**。給一份語言設定檔、一份站台設定、一份標準格式的資料集，
就能建出一個可以跨方言模糊搜尋、每筆資料都查得到出處的靜態辭典網站。

最初為[巴宰–噶哈巫語數位辭典](https://github.com/Babizu/pazeh-kaxabu)而寫，框架本身與語言無關。

- **跨方言模糊搜尋**：多字元加權編輯距離，方言間系統性的語音對應（`r↔l`、詞尾 `l↔n`、`er↔ee`…）只算極小的距離；
  規則寫在語言設定檔（JSON），不用寫程式。另有前綴與包含比對，補足短查詢。
- **快**：詞庫存成 DAWG 詞圖（同時合併共同前綴與後綴），搜尋時動態規劃逐層剪枝，剪枝的正確性有證明與性質測試；
  1 萬多個詞只佔約 0.25 MB 記憶體，查詢數毫秒，在 Web Worker 中執行。
- **溯源**：標準資料格式保留原始拼寫、頁碼、列號、時間碼、原書掃描頁；每筆記錄都有「出處」卡與複製引用。
- **多語言介面**：內建中文與英文，站台可以新增語系（例如族語）或覆寫任何字串；缺的字串自動回退。
- **資料與網站分離**：原始資料與轉接器可以放在私有 repo，只把轉換後的資料集放進公開的網站 repo。
- **純靜態**：hash 路由、相對路徑，放在 GitHub Pages 的子路徑也不用設定。

## 快速開始

需要 Node.js 20.19 以上。

```bash
npm install github:Babizu/babizu#v0.1.0
npx babizu dev        # 在有 babizu.config.js 的目錄
```

從零建立一個站台：[docs/getting-started.md](docs/getting-started.md)。
示範站台（虛構的小語言）：[examples/minimal/](examples/minimal/)。

## 文件

| 文件 | 內容 |
|---|---|
| [getting-started.md](docs/getting-started.md) | 建立一個辭典網站 |
| [concepts.md](docs/concepts.md) | 概念、架構、資料流、模組 |
| [site-config.md](docs/site-config.md) | 站台設定 `babizu.config.js` 的所有欄位與指令 |
| [language-profile.md](docs/language-profile.md) | 語言設定檔：正規化、成本、方言語音對應規則 |
| [data-format.md](docs/data-format.md) | 標準資料格式（資料集）規格 |
| [adapters.md](docs/adapters.md) | 寫轉接器，把原始資料轉成資料集 |
| [i18n.md](docs/i18n.md) | 多語言介面：語系、覆寫字串、新增語系 |
| [fuzzy-search.md](docs/fuzzy-search.md) | 模糊搜尋演算法：遞推式、剪枝正確性、DAWG、複雜度、API |
| [ui-guidelines.md](docs/ui-guidelines.md) | 介面設計規範 |
| [deployment.md](docs/deployment.md) | 部署到 GitHub Pages 或其他靜態主機 |

## 指令

| 指令 | 說明 |
|---|---|
| `babizu dev [站台目錄] [--port]` | 開發伺服器 |
| `babizu build [站台目錄]` | 建置到 `<站台>/dist/` |
| `babizu preview [站台目錄] [--port]` | 預覽建置結果 |
| `babizu check [站台目錄]` | 檢查設定、語言設定檔與資料集 |
| `babizu locales [站台目錄]` | 列出各語系缺少的介面字串 |

## 程式介面

| 子路徑 | 內容 |
|---|---|
| `babizu` | `defineSite`、`defineAdapter` |
| `babizu/fuzzy` | `WeightedEditDistance`、`FuzzyIndex`、`RuleSet`、`createMetricFromProfile`… |
| `babizu/search` | `buildSearchIndex`、`SearchEngine`、`createTextTools` |
| `babizu/schema` | JSON Schema 驗證器、`createRecord` 等輔助函式、代碼表 |
| `babizu/dataset` | 資料集讀寫與驗證 |
| `babizu/pipeline` | `exportDataset`、轉接器工具（試算表、docx、SSA 字幕） |
| `babizu/site` | `loadSiteConfig`、`buildSite`… |

## 開發框架

```bash
npm install
npm test                  # 單元測試（演算法、schema、搜尋引擎、資料管線、站台設定、前端元件、語系完整性）
npm run test:e2e          # 建置示範站台並跑端對端測試（需要 npx playwright install chromium，
                          #   或 PLAYWRIGHT_CHANNEL=msedge 使用本機的 Edge）
npm run example:dev       # 示範站台的開發伺服器
npm run bench             # 模糊搜尋效能基準
```

```
├── bin/babizu.js      指令列工具
├── src/
│   ├── fuzzy/         加權編輯距離、DAWG、語言設定檔（零依賴）
│   ├── schema/        標準資料格式：JSON Schema、代碼表、輔助函式
│   ├── search/        搜尋鍵、索引建置、查詢引擎（建置端與瀏覽器共用）
│   ├── pipeline/      轉接器工具、exportDataset
│   ├── site/          站台設定、網站資料準備、Vite 建置
│   └── dataset.js     資料集讀寫與驗證
├── app/               網站前端（Vue 3＋shadcn-vue＋Tailwind CSS v4）
├── locales/           內建介面語系（zh-TW、en）
├── examples/minimal/  示範站台
├── test/              單元測試
├── e2e/               端對端測試（示範站台）
└── docs/              文件
```

## 授權

[MIT](LICENSE)。使用本框架建置的網站，其資料的授權依各資料來源而定。
