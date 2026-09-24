/**
 * @file 搜尋索引的檔案格式定義（建置端與網站端共用）。
 *
 * ## docs.json：搜尋結果顯示用的精簡摘要（欄式儲存）
 * 每個欄位是一個與記錄數等長的陣列，第 k 筆記錄的資料分散在各陣列的第 k 格。
 * 欄式比「物件陣列」少了重複的鍵名，gzip 後也更小。代碼類欄位存成小整數，
 * 對照表放在同一個檔案裡。
 *
 * ## lexicon.json：序列化的 FuzzyIndex（見 babizu/fuzzy 的 fuzzy-index.js）
 * 詞圖的每個詞（族語搜尋鍵）附帶一組整數 posting，
 * 每個 posting 同時編碼「哪一筆記錄」與「這個詞以什麼身分出現在該記錄」：
 *   code = docIndex × MATCH_KINDS.length + kindIndex
 */

/**
 * 索引格式版本。
 * 2：方言代碼與包含關係改由站台設定提供，寫在 docs.json（`dialects`、`dialectSupersets`），
 *    並附上建索引時用的語言設定檔（`language.json`），查詢端用同一份設定。
 */
export const INDEX_FORMAT_VERSION = 2

/** 方言用 32 位元整數的位元遮罩表示，所以最多 31 種（第 32 位是正負號） */
export const MAX_VARIETIES = 31

/**
 * 詞在記錄中出現的身分（依重要性排序）。
 * - head：記錄本身的詞形
 * - alt：其他書寫系統的寫法（例如潘永歷標記法）
 * - variant：變體（`= barudak`）
 * - root：衍生來源（`< sikis-`）
 * - token：出現在片語或句子之中
 */
export const MATCH_KINDS = /** @type {const} */ (['head', 'alt', 'variant', 'root', 'token'])

/** @typedef {typeof MATCH_KINDS[number]} MatchKind */

export const UNIT_CODES = /** @type {const} */ (['affix', 'word', 'phrase', 'sentence'])
export const ROLE_CODES = /** @type {const} */ (['head', 'form', 'example', 'segment', 'item', ''])
/**
 * @typedef {object} VarietyRef 建索引時需要的語言變體資訊（站台設定 varieties 的子集）
 * @property {string} code
 * @property {string | null} [parent] 所屬的上層變體；例如愛蘭是巴宰的地方變體 → parent: 'pazeh'
 */

/**
 * 由變體清單算出「篩選鍵 → 實際要納入的代碼」：每個變體包含自己與所有下層變體（可多層）。
 * 例如勾「巴宰」時，標為愛蘭的記錄也要出現。
 * @param {VarietyRef[]} varieties
 * @returns {Record<string, string[]>}
 */
export function computeDialectSupersets(varieties) {
  const codes = new Set(varieties.map((v) => v.code))
  const children = new Map(varieties.map((v) => [v.code, /** @type {string[]} */ ([])]))
  for (const v of varieties) {
    if (!v.parent) continue
    if (!codes.has(v.parent)) throw new RangeError(`變體 ${v.code} 的 parent「${v.parent}」不在 varieties 中`)
    children.get(v.parent)?.push(v.code)
  }
  /** @type {Record<string, string[]>} */
  const out = {}
  for (const v of varieties) {
    const seen = new Set()
    const stack = [v.code]
    while (stack.length) {
      const c = /** @type {string} */ (stack.pop())
      if (seen.has(c)) throw new RangeError(`變體的 parent 形成循環：${[...seen, c].join(' → ')}`)
      seen.add(c)
      stack.push(...(children.get(c) ?? []))
    }
    out[v.code] = [...seen]
  }
  return out
}

export const STATUS_CODES = /** @type {const} */ (['unreviewed', 'reviewed', 'verified'])

/**
 * @param {number} docIndex
 * @param {MatchKind} kind
 */
export function encodePosting(docIndex, kind) {
  const k = MATCH_KINDS.indexOf(kind)
  if (k < 0) throw new RangeError(`未知的 posting 類型：${kind}`)
  return docIndex * MATCH_KINDS.length + k
}

/**
 * @param {number} code
 * @returns {{doc: number, kind: MatchKind}}
 */
export function decodePosting(code) {
  return { doc: Math.floor(code / MATCH_KINDS.length), kind: MATCH_KINDS[code % MATCH_KINDS.length] }
}

/**
 * 方言代碼陣列 → 位元遮罩（第 k 位代表 codes[k]）。不在代碼表中的代碼忽略。
 * @param {string[]} dialects
 * @param {readonly string[]} codes
 */
export function encodeDialects(dialects, codes) {
  let mask = 0
  for (const d of dialects) {
    const k = codes.indexOf(d)
    if (k >= 0) mask |= 1 << k
  }
  return mask
}

/**
 * @param {number} mask
 * @param {readonly string[]} codes
 */
export function decodeDialects(mask, codes) {
  return codes.filter((_, k) => (mask & (1 << k)) !== 0)
}

/**
 * @typedef {object} SearchDocs docs.json 的內容
 * @property {number} version
 * @property {number} count
 * @property {string[]} sources 來源 id 對照表
 * @property {readonly string[]} units
 * @property {readonly string[]} roles
 * @property {readonly string[]} dialects 方言代碼表（位元位置即索引）
 * @property {Record<string, string[]>} dialectSupersets 篩選鍵 → 實際納入的方言代碼
 * @property {readonly string[]} statuses
 * @property {string[]} id 記錄 id
 * @property {number[]} source 來源代碼
 * @property {string[]} shard 分片鍵
 * @property {number[]} unit 單位代碼
 * @property {number[]} role 群組角色代碼
 * @property {string[]} text 原始拼寫
 * @property {string[]} zh 中文釋義（多義項以「；」連接）
 * @property {string[]} en 英文釋義（以「; 」連接）
 * @property {string[]} nan 臺語釋義
 * @property {number[]} dialect 方言位元遮罩
 * @property {number[]} status 校對狀態代碼
 * @property {string[]} audio 可播放的音檔路徑（沒有則為空字串）
 * @property {string[]} citation 出處說明
 * @property {string[]} groupTitle 所屬群組標題（例如詞條詞形），沒有則為空字串
 * @property {string[]} groupId 所屬群組 id，沒有則為空字串
 */

/**
 * @typedef {object} DocSummary 由 docs.json 還原的一筆摘要
 * @property {number} index
 * @property {string} id
 * @property {string} source
 * @property {string} shard
 * @property {string} unit
 * @property {string} role
 * @property {string} text
 * @property {string} zh
 * @property {string} en
 * @property {string} nan
 * @property {string[]} dialects
 * @property {string} status
 * @property {string} audio
 * @property {string} citation
 * @property {string} groupTitle
 * @property {string} groupId
 */

/**
 * 取出第 k 筆摘要。
 * @param {SearchDocs} docs
 * @param {number} k
 * @returns {DocSummary}
 */
export function docAt(docs, k) {
  return {
    index: k,
    id: docs.id[k],
    source: docs.sources[docs.source[k]],
    shard: docs.shard[k],
    unit: docs.units[docs.unit[k]],
    role: docs.roles[docs.role[k]],
    text: docs.text[k],
    zh: docs.zh[k],
    en: docs.en[k],
    nan: docs.nan[k],
    dialects: decodeDialects(docs.dialect[k], docs.dialects),
    status: docs.statuses[docs.status[k]],
    audio: docs.audio[k],
    citation: docs.citation[k],
    groupTitle: docs.groupTitle[k],
    groupId: docs.groupId[k],
  }
}
