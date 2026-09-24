/**
 * @file 標準語料的代碼表（與語言無關的部分）。
 *
 * 本檔不依賴任何 Node.js 模組，網站前端可以直接引入。
 * 這裡只有代碼；顯示名稱依介面語系而定，放在 locales/*.json（鍵名見各表的說明）。
 * 新增代碼時，請同步修改 json/record.schema.json 中對應的 enum 與語系檔。
 *
 * 語言變體（方言）因語言而異，不在這裡定義，而是由站台設定的 `varieties` 提供。
 */

/** 語言單位（語系鍵 `unit.<code>`） */
export const UNIT_CODES = Object.freeze(['affix', 'word', 'phrase', 'sentence'])

/** 記錄在群組中的角色（語系鍵 `role.<code>`） */
export const GROUP_ROLE_CODES = Object.freeze(['head', 'form', 'example', 'segment', 'item'])

/** 來源類型（語系鍵 `sourceType.<code>`） */
export const SOURCE_TYPE_CODES = Object.freeze(['dictionary', 'wordlist', 'corpus'])

/**
 * 校對狀態（三級，語系鍵 `status.<code>`）。tone 供介面決定顏色：danger 紅、warning 黃、success 綠。
 * 來源本身沒有校對流程（`reviewTracked: false`）時一律是 unreviewed，而且網站不顯示。
 */
export const QUALITY_STATUSES = Object.freeze({
  unreviewed: { code: 'unreviewed', tone: 'danger' },
  reviewed: { code: 'reviewed', tone: 'warning' },
  verified: { code: 'verified', tone: 'success' },
})

/**
 * 組出全系統唯一的記錄 id。
 * @param {string} source 來源 id
 * @param {string} localId 來源內編號
 */
export function recordId(source, localId) {
  return `${source}:${localId}`
}

/**
 * 拆解記錄 id。
 * @param {string} id
 * @returns {{source: string, localId: string}}
 */
export function parseRecordId(id) {
  const k = id.indexOf(':')
  if (k <= 0) throw new RangeError(`不合法的記錄 id：${id}`)
  return { source: id.slice(0, k), localId: id.slice(k + 1) }
}
