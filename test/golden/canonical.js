/**
 * @file golden 快照用的正規化與雜湊。
 *
 * 正規化的 JSON：物件的鍵排序（鍵的順序不是語意）、陣列保序（是排名）、Map／Set 以內容表示、
 * 型別陣列展開、非有限數寫成字串、-0 寫成 0、耗時欄位（elapsedMs）去掉、函式去掉、詞條物件以編號代替。
 */

import { createHash } from 'node:crypto'

/**
 * @param {unknown} x
 * @param {string} [key] 這個值在上一層的鍵
 * @returns {unknown}
 */
export function canonical(x, key = '') {
  if (key === 'elapsedMs') return undefined
  if (typeof x === 'number') return Number.isFinite(x) ? (Object.is(x, -0) ? 0 : x) : String(x)
  if (x === null || typeof x !== 'object') return typeof x === 'function' ? undefined : x
  const o = /** @type {any} */ (x)
  if (key === 'doc' && typeof o.id === 'string') return o.id
  if (o instanceof Map) return { '#Map': [...o].map(([k, v]) => [canonical(k), canonical(v)]) }
  if (o instanceof Set) return { '#Set': [...o].map((v) => canonical(v)) }
  if (ArrayBuffer.isView(o)) return Array.from(/** @type {any} */ (o))
  if (Array.isArray(o)) return o.map((v) => canonical(v))
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const k of Object.keys(o).sort()) {
    const v = canonical(o[k], k)
    if (v !== undefined) out[k] = v
  }
  return out
}

/** 值的雜湊（正規化的 JSON 的 SHA-1） @param {unknown} x */
export function digest(x) {
  return createHash('sha1')
    .update(JSON.stringify(canonical(x)) ?? 'undefined')
    .digest('hex')
}

/** 位元組的雜湊 @param {string | Buffer} bytes */
export function digestBytes(bytes) {
  return createHash('sha1').update(bytes).digest('hex')
}
