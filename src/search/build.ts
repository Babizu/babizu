/**
 * @file 由標準記錄建立搜尋索引（在建置流程中執行）。
 */

import { assertProfile, FuzzyIndex, type LanguageProfile, type SerializedIndex } from '#bcdp'
import type { CorpusGroup, CorpusRecord } from '../schema/types.ts'
import { computeParents } from './family.ts'
import {
  computeDialectSupersets,
  INDEX_FORMAT_VERSION,
  MAX_VARIETIES,
  ROLE_CODES,
  STATUS_CODES,
  UNIT_CODES,
  encodeDialects,
  encodePosting,
  type SearchDocs,
  type VarietyRef,
} from './format.ts'
import { collectSegmentations, type SegmentationData } from './segmentation.ts'
import { createTextTools } from './text.ts'

/** buildSearchIndex 的結果 */
export interface BuiltSearchIndex {
  docs: SearchDocs
  lexicon: SerializedIndex
  /** 查詢端要用同一份設定檔，搜尋鍵與距離才會和建索引時一致 */
  profile: LanguageProfile
  /** 有人工拆解的記錄（檢查清單的人工拆解對照用，網站另存成 search/segmentations.json） */
  segmentations: SegmentationData
  stats: { terms: number; postings: number; nodes: number; edges: number }
}

/**
 * 建立搜尋索引。
 * @param input.items 所有記錄及其所在分片（順序即 doc 編號）
 * @param input.groups 所有群組（用來取群組標題）
 * @param input.sourceIds 來源 id（決定來源代碼）
 * @param input.profile 語言設定檔（搜尋鍵與距離規則）
 * @param input.varieties 語言變體（方言）清單，順序決定位元位置
 */
export function buildSearchIndex({
  items,
  groups,
  sourceIds,
  profile,
  varieties = [],
}: {
  items: Array<{ record: CorpusRecord; shard: string }>
  groups: CorpusGroup[]
  sourceIds: string[]
  profile: LanguageProfile
  varieties?: VarietyRef[]
}): BuiltSearchIndex {
  assertProfile(profile)
  if (varieties.length > MAX_VARIETIES) {
    throw new RangeError(`語言變體最多 ${MAX_VARIETIES} 種（目前 ${varieties.length} 種）`)
  }
  const { searchKey, tokenize, createSearchMetric } = createTextTools(profile)
  const dialectCodes = varieties.map((v) => v.code)
  const groupTitles = new Map(groups.map((g) => [g.id, g.title]))

  const docs: SearchDocs = {
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
    parent: [],
  }

  /** 搜尋鍵 → posting 代碼 */
  const postings = new Map<string, Set<number>>()
  const addPosting = (key: string, code: number) => {
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

  docs.parent = computeParents(items, groups, searchKey)

  // 依鍵排序後加入，讓輸出穩定、方便比對兩次建置的差異
  const index = new FuzzyIndex(createSearchMetric())
  let postingCount = 0
  for (const key of [...postings.keys()].sort()) {
    for (const code of [...(postings.get(key) as Set<number>)].sort((a, b) => a - b)) {
      index.add(key, code)
      postingCount++
    }
  }

  return {
    docs,
    lexicon: index.serialize(),
    profile,
    segmentations: collectSegmentations(items),
    stats: { terms: index.size, postings: postingCount, nodes: index.dawg.nodeCount, edges: index.dawg.edgeCount },
  }
}

function joinSenses(record: CorpusRecord, field: 'zh' | 'en' | 'nan', separator: string): string {
  return record.senses
    .map((s) => s[field])
    .filter(Boolean)
    .join(separator)
}
