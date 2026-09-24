# CLAUDE.md

Babizu：與語言無關的辭典網站框架（跨方言模糊搜尋、標準資料格式、多語系介面、靜態建置）。
公開 repo `Babizu/babizu`；站台以 `github:Babizu/babizu#vX.Y.Z` 引用。第一個使用者是 `../pazeh-kaxabu`（巴宰–噶哈巫語）。
三個 repo 的關係與日常流程見 `../pazeh-kaxabu-minubizu/WORKSPACE.md`。

使用者以繁體中文溝通；程式註解、JSDoc、文件、commit 訊息一律用繁體中文。

## 指令

```bash
npm test                                     # 單元測試（node＋jsdom 兩個 project，約 140 個）
PLAYWRIGHT_CHANNEL=msedge npm run test:e2e   # 建置 examples/minimal 後跑端對端（320／1280）
npm run example:dev                          # 示範站台
node bin/babizu.js build ../pazeh-kaxabu     # 用本機框架建真實站台
```

- 端對端測試跑的是建置結果，**改了程式要先重新 build**。`reuseExistingServer` 在本機為 true：
  如果 4173／4180 埠上有別的 preview 伺服器（例如舊專案的），測試會打到它而不是新的建置——先確認埠是空的。
- 搜尋行為的改動要用巴宰–噶哈巫語的真實資料驗證：`../pazeh-kaxabu` 建置後跑它的端對端測試。

## 結構

| 位置 | 內容 |
|---|---|
| `src/fuzzy/` | 加權編輯距離＋DAWG 詞圖搜尋＋語言設定檔（`profile.js`），零依賴；有「與暴力計算比對」的性質測試 |
| `src/schema/` | JSON Schema（`json/`）、代碼表（`constants.js`）、工廠函式；`dialects` 允許值由站台設定注入 |
| `src/search/` | `text.js`（`createTextTools(profile)`）、`build.js`（索引）、`engine.js`（查詢），建置端與 Worker 共用 |
| `src/pipeline/` | 轉接器工具、`exportDataset`（驗證→寫資料集→同步並清除媒體） |
| `src/site/` | `config.js`（讀站台設定）、`prepare.js`（資料集→網站資料＋索引）、`vite.js`（虛擬模組 `virtual:babizu/site`） |
| `app/` | Vue 3＋Tailwind v4＋手動移植的 shadcn-vue（JS 版）；`i18n.js` 自製語系 |
| `locales/` | `zh-TW.json`、`en.json`，鍵必須完全相同（`test/site/locales.test.js` 檢查） |
| `examples/minimal/` | 虛構語言的示範站台，也是端對端測試對象 |
| `test/fixtures/` | 巴宰–噶哈巫語的語言設定檔與測試用站台設定（有從屬變體與真實規則表） |

## 慣例

- **框架裡不能寫死任何語言的內容**：變體代碼、方言名稱、詞形範例、來源名稱都來自站台設定或語言設定檔。
  註解與測試可以用巴宰–噶哈巫語當例子，但執行路徑不能依賴它。
- **介面文字一律 `t('鍵')`**，同時加進兩個語系檔；代碼的顯示名稱用 `app/src/lib/labels.js`。
- **搜尋索引格式**（`INDEX_FORMAT_VERSION`）改了要升版；`SearchEngine` 會拒絕版本不符的索引。
- **UI 設計語言**見 `docs/ui-guidelines.md`：小圓角（3px 基準）、髮絲線不用陰影、不用漸層、目標語言用 Gentium Book Plus。
- **前端非同步**：切換頁面時舊請求可能晚回來，載入函式要檢查「這還是目前的請求」再寫入狀態。
- **公開 repo**：不要把任何未取得公開授權的資料（詞形、釋義、來源檔）寫進測試、文件、範例或 commit；哪些來源受限見私有 repo 的 `docs/data-decisions.md`。
- 發版：更新 `package.json` 版本 → commit → `git tag vX.Y.Z` → push 標籤；站台 repo 再改依賴版本。

## Windows 環境的坑

- Bash heredoc 會把 `\\` 吃成 `\`（單一反斜線不受影響），遇到引號與反引號也容易壞；含反斜線或特殊字元的內容用 Write／Edit 工具。
- 終端機是 cp950，印出來的中文會變亂碼，但檔案本身是 UTF-8；要看內容就 `PYTHONIOENCODING=utf-8` 或用 Read 工具。
