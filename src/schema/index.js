/**
 * @file babizu/schema：標準語料格式（Node.js 端）。
 *
 * 網站前端只需要代碼表時，請改引入 `babizu/schema/constants`，以免把 Ajv 打包進瀏覽器。
 * 格式規格見 docs/data-format.md。
 */

export * from './constants.js'
export { createRecord, createGroup, createCitation, createSense } from './records.js'
export { createValidators, formatErrors, SCHEMA_BASE } from './validate.js'
