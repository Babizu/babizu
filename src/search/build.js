/**
 * @file 由標準記錄建立搜尋索引（在建置流程中執行）。
 */

import { assertProfile, FuzzyIndex } from '../fuzzy/index.js'
import {
  computeDialectSupersets,
  INDEX_FORMAT_VERSION,
  MAX_VARIETIES,
  ROLE_CODES,
  STATUS_CODES,
  UNIT_CODES,
  encodeDialects,
  encodePosting,
} from './format.js'
import { createTextTools } from './text.js'

/**
 * @typedef {import('../schema/types.js').CorpusRecord} CorpusRecord
 * @typedef {import('../schema/types.js').CorpusGroup} CorpusGroup
 */

/**
 * 建立搜尋索引。
 *
 * @param {object} input
 * @param {Array<{record: CorpusRecord, shard: string}>} input.items 所有記錄及其所在分片（順序即 doc 編號）
 * @param {CorpusGroup[]} input.groups 所有群組（用來取群組標題）
 * @param {string[]} input.sourceIds 來源 id（決定來源代碼）
 * @param {import('../fuzzy/profile.js').LanguageProfile} input.profile 語言設定檔（搜尋鍵與距離規則）
 * @param {import('./format.js').VarietyRef[]} [input.varieties] 語言變體（方言）清單，順序決定位元位置
 * @returns {{
 *   docs: import('./format.js').SearchDocs,
 *   lexicon: import('../fuzzy/fuzzy-index.js').SerializedIndex,
 *   profile: import('../fuzzy/profile.js').LanguageProfile,
 *   stats: {terms: number, postings: number, nodes: number, edges: number},
 * }}
 */
export function buildSearchIndex({ items, groups, sourceIds, profile, varieties = [] }) {
  assertProfile(profile)
  if (varieties.length > MAX_VARIETIES) {
    throw new RangeError(`語言變體最多 ${MAX_VARIETIES} 種（目前 ${varieties.length} 種）`)
  }
  const { searchKey, tokenize, createSearchMetric } = createTextTools(profile)
  const dialectCodes = varieties.map((v) => v.code)
  const groupTitles = new Map(groups.map((g) => [g.id, g.title]))

  /** @type {import('./format.js').SearchDocs} */
  const docs = {
    version: INDEX_FORMAT_VERSION,
    count: items.length,
    sources: [...sourceIds],
    units: UNIT_CODES,
    roles: ROLE_CODES,
    dialects: dialectCodes,
    dialectSupersets: computeDialectSupersets(varieties),
    statuses: STATUS_CODES,
    id: [],
    source: [],
    shard: [],
    unit: [],
    role: [],
    text: [],
    zh: [],
    en: [],
    nan: [],
    dialect: [],
    status: [],
    audio: [],
    citation: [],
    groupTitle: [],
    groupId: [],
  }

  /** @type {Map<string, Set<number>>} 搜尋鍵 → posting 代碼 */
  const postings = new Map()
  /** @param {string} key @param {number} code */
  const addPosting = (key, code) => {
    if (!key) return
    let set = postings.get(key)
    if (!set) postings.set(key, (set = new Set()))
    set.add(code)
  }

  items.forEach(({ record, shard }, k) => {
    const sourceIndex = docs.sources.indexOf(record.source)
    if (sourceIndex < 0) throw new RangeError(`記錄 ${record.id} 的來源 ${record.source} 不在 sourceIds 中`)

    docs.id.push(record.id)
    docs.source.push(sourceIndex)
    docs.shard.push(shard)
    docs.unit.push(UNIT_CODES.indexOf(record.unit))
    docs.role.push(ROLE_CODES.indexOf(record.group?.role ?? ''))
    docs.text.push(record.text)
    docs.zh.push(joinSenses(record, 'zh', '；'))
    docs.en.push(joinSenses(record, 'en', '; '))
    docs.nan.push(joinSenses(record, 'nan', '；'))
    docs.dialect.push(encodeDialects(record.dialects, dialectCodes))
    docs.status.push(STATUS_CODES.indexOf(record.quality.status))
    docs.audio.push(record.media.find((m) => m.type === 'audio' && m.available && m.src)?.src ?? '')
    docs.citation.push(record.citation.label)
    docs.groupTitle.push(record.group ? (groupTitles.get(record.group.id) ?? '') : '')
    docs.groupId.push(record.group?.id ?? '')

    // 詞形本身：句子太長，不當作詞庫中的詞，只索引其中的詞
    if (record.unit !== 'sentence') addPosting(searchKey(record.text), encodePosting(k, 'head'))
    for (const alt of record.altTexts) addPosting(searchKey(alt.text), encodePosting(k, 'alt'))
    for (const v of record.variants) addPosting(searchKey(v.text), encodePosting(k, 'variant'))
    for (const d of record.morphology?.derivedFrom ?? []) addPosting(searchKey(d.text), encodePosting(k, 'root'))
    if (record.unit === 'phrase' || record.unit === 'sentence') {
      for (const token of tokenize(record.text)) addPosting(token, encodePosting(k, 'token'))
    }
  })

  // 依鍵排序後加入，讓輸出穩定、方便比對兩次建置的差異
  const index = new FuzzyIndex(createSearchMetric())
  let postingCount = 0
  for (const key of [...postings.keys()].sort()) {
    for (const code of [...postings.get(key)].sort((a, b) => a - b)) {
      index.add(key, code)
      postingCount++
    }
  }

  return {
    docs,
    lexicon: index.serialize(),
    // 查詢端要用同一份設定檔，搜尋鍵與距離才會和建索引時一致
    profile,
    stats: { terms: index.size, postings: postingCount, nodes: index.dawg.nodeCount, edges: index.dawg.edgeCount },
  }
}

/**
 * @param {CorpusRecord} record
 * @param {'zh' | 'en' | 'nan'} field
 * @param {string} separator
 */
function joinSenses(record, field, separator) {
  return record.senses
    .map((s) => s[field])
    .filter(Boolean)
    .join(separator)
}
