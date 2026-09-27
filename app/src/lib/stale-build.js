/**
 * @file 舊分頁遇到新部署：重新載入一次。
 *
 * 程式分塊的檔名帶內容雜湊，網站重新部署後舊檔案就不在了。還開著的舊分頁切換頁面時要載入的分塊會 404，
 * 重新載入整個頁面就會拿到新版的 index.html 與分塊。為了避免真的壞掉時無限重新載入，
 * 30 秒內只重新載入一次（記在 sessionStorage；不能用時就不重新載入，交給一般的錯誤處理）。
 */

const KEY = 'babizu:stale-build-reload'
const WINDOW_MS = 30_000

/**
 * 重新載入頁面（30 秒內只做一次）。
 * @param {string} [hashPath] 要前往的路由（hash 模式的路徑，例如 /r/src/1）；省略時重新載入目前的網址
 * @returns {boolean} 是否已經要重新載入
 */
export function reloadOnce(hashPath) {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (Date.now() - last < WINDOW_MS) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return false
  }
  if (hashPath) window.location.hash = hashPath
  window.location.reload()
  return true
}
