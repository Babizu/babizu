/**
 * @file 測試共用工具：可重現的亂數產生器。
 */

/**
 * mulberry32：32 位元種子的簡單 PRNG，讓性質測試失敗時可以用同一個種子重現。
 * @returns 回傳 [0, 1) 的亂數
 */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 由 alphabet 隨機組成、長度在 [minLength, maxLength] 之間的字串 */
export function randomString(random: () => number, alphabet: readonly string[], minLength: number, maxLength: number): string {
  const length = minLength + Math.floor(random() * (maxLength - minLength + 1))
  let s = ''
  for (let k = 0; k < length; k++) s += alphabet[Math.floor(random() * alphabet.length)]
  return s
}

/** 隨機取一個 */
export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]
}
