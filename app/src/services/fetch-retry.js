/**
 * @file 可重試的 fetch：網路暫時中斷、伺服器暫時錯誤（408、429、5xx）時自動再試幾次。
 *
 * 靜態網站的資料檔很大（搜尋索引數 MB），行動網路上偶爾斷線或逾時；GitHub Pages 偶爾回 5xx。
 * 這些是暫時的，隔一下再試通常就好；404 之類的永久錯誤不重試，直接交給呼叫端顯示。
 * 主執行緒與 Web Worker 共用。
 */

/** 值得重試的 HTTP 狀態 */
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504])

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{retries?: number, delay?: number}} [options] retries：另外再試幾次；delay：第一次重試前等幾毫秒（之後加倍）
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, init, { retries = 2, delay = 500 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, init)
      if (res.ok || !TRANSIENT.has(res.status) || attempt >= retries) return res
    } catch (err) {
      // 網路錯誤（離線、連線中斷、CORS 以外的 TypeError）
      if (attempt >= retries) throw err
    }
    await new Promise((resolve) => setTimeout(resolve, delay * 2 ** attempt))
  }
}
