/**
 * @file 以 JSON Schema 驗證標準語料（僅供 Node.js 端的建置流程使用）。
 */

import { readFileSync } from 'node:fs'
import { Ajv, type ErrorObject } from 'ajv'

export const SCHEMA_BASE = 'https://github.com/Babizu/babizu/schema/'

/** 一個 schema 的驗證函式：通過時回傳 true；不通過時 errors 是錯誤清單 */
export type Validator = ((data: unknown) => boolean) & { errors?: ErrorObject[] | null }

/** JSON Schema 放在 src/schema/json（不經編譯）：src/schema 與 dist/schema 都在套件根目錄下兩層，由那裡找回去 */
const SCHEMA_DIR = new URL('../../src/schema/json/', import.meta.url)

function loadSchema(name: string) {
  return JSON.parse(readFileSync(new URL(`${name}.schema.json`, SCHEMA_DIR), 'utf8'))
}

/**
 * 建立驗證器。所有 schema 共用一個 Ajv 實例，以便互相 $ref。
 *
 * 語言變體（方言）代碼因語言而異，schema 本身只規定格式；
 * 傳入 `dialects` 時會把它設為允許清單，出現清單外的代碼就驗證失敗。
 */
export function createValidators({ dialects }: { dialects?: string[] } = {}): Record<'record' | 'group' | 'source' | 'shard', Validator> {
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true })
  const schemas = ['record', 'group', 'source', 'shard'].map(loadSchema)
  if (dialects) {
    const record = schemas[0]
    // 站台沒有定義任何變體時，記錄就不應該帶方言代碼；JSON Schema 不允許空的 enum，改用永遠不成立的 false
    record.definitions.dialect = dialects.length > 0 ? { ...record.definitions.dialect, enum: [...dialects] } : false
  }
  for (const schema of schemas) ajv.addSchema(schema)

  const get = (name: string) => {
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
 * @param context 例如記錄 id
 */
export function formatErrors(errors: ErrorObject[] | null | undefined, context = ''): string[] {
  if (!errors) return []
  const prefix = context ? `${context}：` : ''
  return errors.map((e) => {
    const where = e.instancePath || '(根)'
    const extra = e.params && Object.keys(e.params).length > 0 ? ` ${JSON.stringify(e.params)}` : ''
    return `${prefix}${where} ${e.message ?? '不符合 schema'}${extra}`
  })
}
