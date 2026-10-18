/** 站台設定（框架的 Vite 外掛在建置時注入，見 src/site/vite.ts） */
declare module 'virtual:babizu/site' {
  const site: import('@babizu/site/client.ts').ClientSite
  export default site
}

/** 前端的建置代號（每次建置不同；src/site/vite.ts 的 define）：展示版判斷 IndexedDB 裡的建置結果是不是這一版程式做的 */
declare const __BABIZU_BUILD_ID__: string
