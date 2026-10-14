/**
 * @file 測試共用工具：可重現的亂數產生器。
 */

/**
 * mulberry32：32 位元種子的簡單 PRNG，讓性質測試失敗時可以用同一個種子重現。
 * @param {number} seed
 * @returns {() => number} 回傳 [0, 1) 的亂數
 */
export function createRandom(seed) {
  let a = seed >>> 0
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * @param {() => number} random
 * @param {string[]} alphabet
 * @param {number} minLength
 * @param {number} maxLength
 */
export function randomString(random, alphabet, minLength, maxLength) {
  const length = minLength + Math.floor(random() * (maxLength - minLength + 1))
  let s = ''
  for (let k = 0; k < length; k++) s += alphabet[Math.floor(random() * alphabet.length)]
  return s
}

/**
 * @template T
 * @param {() => number} random
 * @param {T[]} items
 * @returns {T}
 */
export function pick(random, items) {
  return items[Math.floor(random() * items.length)]
}
