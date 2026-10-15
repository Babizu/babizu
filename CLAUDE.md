# CLAUDE.md

Babizu：與語言無關的辭典網站框架（跨方言模糊搜尋、標準資料格式、多語系介面、靜態建置）。
公開 repo `Babizu/babizu`；站台以 `github:Babizu/babizu#vX.Y.Z` 引用。第一個使用者是 `../pazeh-kaxabu`（巴宰–噶哈巫語）。
三個 repo 的關係與日常流程見 `../pazeh-kaxabu-minubizu/WORKSPACE.md`。

使用者以繁體中文溝通；程式註解、文件、commit 訊息一律用繁體中文。

## 指令

```bash
npm test                                     # 單元測試（node＋jsdom 兩個 project）
npm run typecheck                            # tsc -b（src、bin 依賴的 dist、packages/bcdp）＋ vue-tsc（app）
PLAYWRIGHT_CHANNEL=msedge npm run test:e2e   # 建置 examples/minimal 後跑端對端（320／1280）
npm run example:dev                          # 示範站台
npm run zoo                                  # 錯誤解法動物園：每個突變都要被單元測試殺掉
node --conditions=babizu-source bin/babizu.js build ../pazeh-kaxabu   # 用本機框架的原始碼建真實站台
```

- 全部是 TypeScript，只用可以直接抹掉的語法（`erasableSyntaxOnly`）：Node ≥ 22.18 以 `--conditions=babizu-source`
  直接執行原始碼，Vite 與 Vitest 也吃原始碼；安裝時 `prepare`（`tsc -b`）把框架與 BCDP 套件編譯到 `dist/`，
  站台的 CLI 跑的是 dist。不加條件執行時載入的是 dist（可能是舊的）。
- 端對端測試跑的是建置結果，**改了程式要先重新 build**。`reuseExistingServer` 在本機為 true：
  如果 4173／4180 埠上有別的 preview 伺服器（例如舊專案的），測試會打到它而不是新的建置——先確認埠是空的。
- 搜尋行為的改動要用巴宰–噶哈巫語的真實資料驗證：`../pazeh-kaxabu` 建置後跑它的端對端測試；
  私有 repo 有 golden 快照（`tools/refactor/golden.mjs`）與評估工具。

## 結構

| 位置 | 內容 |
|---|---|
| `packages/bcdp/` | 零依賴的 BCDP 套件（`#bcdp`、`babizu/fuzzy`）：加權編輯距離、DAWG 詞圖與多通道走訪（`channel-walk.ts`）、交界狀態、語言設定檔、構詞規格與構詞文法、構詞搜尋（`morph-*.ts`）、虛擬詞根；`fst/` 是只供評估的 WFST 參考後端。不能 import babizu。演算法說明見 `packages/bcdp/docs/bcdp.md` |
| `src/schema/` | JSON Schema（`json/`）、代碼表（`constants.ts`）、記錄的型別與工廠函式；`dialects` 允許值由站台設定注入 |
| `src/search/` | 建置端：索引（`build.ts`）、自動派生圖（`derivations.ts`）、拆解表（`parses.ts`）。查詢端：`engine.ts`（門面）、詞形比對（`term-matcher.ts`、`derived-terms.ts`、`substring-index.ts`）、詞條與例句（`native-search.ts`、`entry-search.ts`、`occurrence-search.ts`）、釋義、分數（`scoring.ts`）、詞條家族（`family.ts`）、檢查清單 |
| `src/pattern/` | 句型搜尋（`docs/pattern-query.md`） |
| `src/pipeline/` | 轉接器工具、`exportDataset`（驗證→寫資料集→同步並清除媒體） |
| `src/site/` | `config.ts`（讀站台設定；送進瀏覽器的部分見 `client.ts`）、`prepare.ts`（資料集→網站資料＋索引）、`vite.ts`（虛擬模組 `virtual:babizu/site`） |
| `app/` | Vue 3（`<script setup lang="ts">`）＋Tailwind v4＋手動移植的 shadcn-vue；`i18n.ts` 自製語系；搜尋在 Web Worker（`workers/search.worker.ts`，用戶端的型別由它的方法表推出） |
| `locales/` | 譯文檔：`en.json`（中文原文 → 英文）。中文是原文語系，直接寫在程式裡，沒有語系檔；`test/site/locales.test.ts` 從程式抽出字串檢查譯文齊全 |
| `examples/minimal/` | 虛構語言的示範站台，也是端對端測試對象 |
| `test/fixtures/` | 巴宰–噶哈巫語的語言設定檔與測試用站台設定（有從屬變體與真實規則表） |
| `test/zoo/` | 突變清單（`mutants.ts`）與執行器；改了程式後突變的 `find` 要仍然只出現一次 |

## 慣例

- **框架裡不能寫死任何語言的內容**：變體代碼、方言名稱、詞形範例、來源名稱都來自站台設定或語言設定檔。
  註解與測試可以用巴宰–噶哈巫語當例子，但執行路徑不能依賴它。
- **介面文字一律 `t('中文原文')`**（對照表等不在呼叫處的字串用 `msg('…')`，不用樣板字串組鍵），英文加進 `locales/en.json`；代碼的顯示名稱用 `app/src/lib/labels.ts`。見 `docs/i18n.md`。
- **元件的 props** 用執行期宣告加 `Object as PropType<T>`；`defineProps<T>()` 這類型別參數只能用本檔定義的型別
  （網站沒有安裝 typescript，compiler-sfc 解析不了引用的型別；`test/site/sfc-types.test.ts` 檢查）。
- **搜尋索引格式**（`INDEX_FORMAT_VERSION`）改了要升版；`SearchEngine` 會拒絕版本不符的索引。
- **UI 設計語言**見 `docs/ui-guidelines.md`：小圓角（3px 基準）、髮絲線不用陰影、不用漸層、目標語言用 Gentium Book Plus。
- **前端非同步**：切換頁面時舊請求可能晚回來，用 `useLatestRequest` 確認「這還是目前的請求」再寫入狀態。
- **公開 repo**：不要把任何未取得公開授權的資料（詞形、釋義、來源檔）寫進測試、文件、範例或 commit；哪些來源受限見私有 repo 的 `docs/data-decisions.md`。
- **不要執行 prettier**：程式沒有照 prettier 排版，跑了會改動大量無關的檔案。
- 發版：更新 `package.json` 版本 → commit → `git tag vX.Y.Z` → push 標籤；站台 repo 再改依賴版本。

## Windows 環境的坑

- Bash heredoc 會把 `\\` 吃成 `\`（單一反斜線不受影響），遇到引號與反引號也容易壞；含反斜線或特殊字元的內容用 Write／Edit 工具。
- 終端機是 cp950，印出來的中文會變亂碼，但檔案本身是 UTF-8；要看內容就 `PYTHONIOENCODING=utf-8` 或用 Read 工具。
