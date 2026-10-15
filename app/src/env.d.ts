/** 站台設定（框架的 Vite 外掛在建置時注入，見 src/site/vite.ts） */
declare module 'virtual:babizu/site' {
  const site: import('@babizu/site/client.ts').ClientSite
  export default site
}
