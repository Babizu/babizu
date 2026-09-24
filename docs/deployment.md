# 部署

`babizu build` 的輸出（`<站台>/dist/`）是純靜態網站，放上任何靜態主機即可。

- 使用相對路徑與 hash 路由（`/#/?q=…`），**放在子路徑不需要任何設定**：
  `https://<帳號>.github.io/<repo>/` 這種專案頁面可以直接用。
- 沒有伺服器端邏輯，也不需要 rewrite 規則（hash 路由不會對伺服器要求 `/r/...` 這種路徑）。
- 輸出根目錄有 `.nojekyll`，GitHub Pages 不會用 Jekyll 處理（會忽略底線開頭的檔案）。
- 首頁只載入搜尋索引（gzip 後大約是資料量的幾分之一），分片、音檔、掃描圖都按需載入。

## GitHub Pages（GitHub Actions）

站台 repo 放這個 workflow（`.github/workflows/deploy.yml`）：

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx babizu check
      - run: npx babizu build
      - uses: actions/upload-pages-artifact@v4
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

第一次要到 repo 的 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。

注意：

- GitHub 免費方案只有**公開** repo 能使用 Pages。原始資料需要保密時，把原始資料與轉接器放在私有 repo，
  只把匯出的資料集放進公開的網站 repo（見 [concepts.md](concepts.md)）。
- 資料集放進版本管理（`data/`），搜尋索引與 `dist/` 不放（建置時產生，加進 `.gitignore`）。
- 大型媒體檔：GitHub 單檔上限 100 MB、repo 建議 1 GB 以內。音檔轉成單聲道 64 kbps mp3、掃描圖轉 WebP 通常就夠小。

## 引用框架的版本

站台 repo 以 git 標籤引用框架，`npm ci` 就能重現同一個版本：

```json
{
  "dependencies": { "babizu": "github:Babizu/babizu#v0.1.0" }
}
```

同時開發框架與站台時，改成本機路徑：

```json
{
  "dependencies": { "babizu": "file:../babizu" }
}
```

`npm install` 之後 `node_modules/babizu` 會是指向本機框架的連結，框架的修改立即生效（`babizu dev` 也會即時重新載入）。
發布前記得改回標籤並重新 `npm install`，否則 CI 找不到 `../babizu`。

## 其他主機

| 主機 | 設定 |
|---|---|
| Netlify／Cloudflare Pages | 建置指令 `npx babizu build`，輸出目錄 `dist` |
| 任何 web server | 把 `dist/` 的內容複製到網站目錄 |

音檔與掃描圖以一般靜態檔案提供；需要支援拖曳播放進度時，主機要支援 HTTP Range 請求（主流主機都支援）。
