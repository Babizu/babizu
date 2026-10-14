/**
 * @file 公開 API 的參數檢查。
 *
 * 程式錯誤（型別、範圍）在 API 的邊界上以清楚的訊息丟出，而不是在演算法內部變成空結果、NaN，
 * 或把 undefined 當成空字串。只檢查呼叫端給的參數，每次呼叫只檢查一次；熱迴圈中不檢查。
 */

/** @param {unknown} value */
const show = (value) => (typeof value === 'string' ? JSON.stringify(value) : Array.isArray(value) ? '陣列' : String(value))

/**
 * @param {unknown} value
 * @param {string} name 參數的名稱（錯誤訊息用）
 * @returns {asserts value is string}
 */
export function requireString(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name}必須是字串（收到 ${show(value)}）`)
}

/**
 * 成本或距離上限：非負數，可以是 Infinity。
 * @param {unknown} value
 * @param {string} name
 * @returns {asserts value is number}
 */
export function requireCost(value, name) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) throw new RangeError(`${name}必須是非負數或 Infinity（收到 ${show(value)}）`)
}

/**
 * 筆數上限：非負整數，或 Infinity（不限）。
 * @param {unknown} value
 * @param {string} name
 * @returns {asserts value is number}
 */
export function requireLimit(value, name) {
  if (typeof value !== 'number' || !(value === Infinity || (Number.isInteger(value) && value >= 0))) {
    throw new RangeError(`${name}必須是非負整數或 Infinity（收到 ${show(value)}）`)
  }
}
