/**
 * @file 以 JSON Schema 驗證標準語料（僅供 Node.js 端的建置流程使用）。
 */

import { readFileSync } from 'node:fs'
import Ajv from 'ajv'

export const SCHEMA_BASE = 'https://github.com/Babizu/babizu/schema/'

/** @param {string} name */
function loadSchema(name) {
  const url = new URL(`./json/${name}.schema.json`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8'))
}

/**
 * 建立驗證器。所有 schema 共用一個 Ajv 實例，以便互相 $ref。
 *
 * 語言變體（方言）代碼因語言而異，schema 本身只規定格式；
 * 傳入 `dialects` 時會把它設為允許清單，出現清單外的代碼就驗證失敗。
 *
 * @param {{dialects?: string[]}} [options]
 */
export function createValidators({ dialects } = {}) {
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true })
  const schemas = ['record', 'group', 'source', 'shard'].map(loadSchema)
  if (dialects) {
    const record = schemas[0]
    // 站台沒有定義任何變體時，記錄就不應該帶方言代碼；JSON Schema 不允許空的 enum，改用永遠不成立的 false
    record.definitions.dialect = dialects.length > 0 ? { ...record.definitions.dialect, enum: [...dialects] } : false
  }
  for (const schema of schemas) ajv.addSchema(schema)

  /** @param {string} name */
  const get = (name) => {
    const fn = ajv.getSchema(`${SCHEMA_BASE}${name}.schema.json`)
    if (!fn) throw new Error(`找不到 schema：${name}`)
    return fn
  }

  return {
    record: get('record'),
    group: get('group'),
    source: get('source'),
    shard: get('shard'),
  }
}

/**
 * 把 Ajv 錯誤轉成人類可讀的訊息。
 * @param {import('ajv').ErrorObject[] | null | undefined} errors
 * @param {string} [context] 例如記錄 id
 * @returns {string[]}
 */
export function formatErrors(errors, context = '') {
  if (!errors) return []
  const prefix = context ? `${context}：` : ''
  return errors.map((e) => {
    const where = e.instancePath || '(根)'
    const extra = e.params && Object.keys(e.params).length > 0 ? ` ${JSON.stringify(e.params)}` : ''
    return `${prefix}${where} ${e.message ?? '不符合 schema'}${extra}`
  })
}
