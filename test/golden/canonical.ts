/**
 * @file golden 快照用的正規化與雜湊。
 *
 * 正規化的 JSON：物件的鍵排序（鍵的順序不是語意）、陣列保序（是排名）、Map／Set 以內容表示、
 * 型別陣列展開、非有限數寫成字串、-0 寫成 0、耗時欄位（elapsedMs）去掉、函式去掉、詞條物件以編號代替。
 */

import { createHash } from 'node:crypto'

/**
 * @param key 這個值在上一層的鍵
 */
export function canonical(x: unknown, key: string = ''): unknown {
  if (key === 'elapsedMs') return undefined
  if (typeof x === 'number') return Number.isFinite(x) ? (Object.is(x, -0) ? 0 : x) : String(x)
  if (x === null || typeof x !== 'object') return typeof x === 'function' ? undefined : x
  const o = x as any
  if (key === 'doc' && typeof o.id === 'string') return o.id
  if (o instanceof Map) return { '#Map': [...o].map(([k, v]) => [canonical(k), canonical(v)]) }
  if (o instanceof Set) return { '#Set': [...o].map((v) => canonical(v)) }
  if (ArrayBuffer.isView(o)) return Array.from(o as any)
  if (Array.isArray(o)) return o.map((v) => canonical(v))
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(o).sort()) {
    const v = canonical(o[k], k)
    if (v !== undefined) out[k] = v
  }
  return out
}

/** 值的雜湊（正規化的 JSON 的 SHA-1） */
export function digest(x: unknown) {
  return createHash('sha1')
    .update(JSON.stringify(canonical(x)) ?? 'undefined')
    .digest('hex')
}

/** 位元組的雜湊 */
export function digestBytes(bytes: string | Buffer) {
  return createHash('sha1').update(bytes).digest('hex')
}
