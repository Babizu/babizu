/**
 * @file 詞條命中：整個查詢對應的詞庫詞，經 posting 落在哪些記錄上（詞形、變體、其他寫法、詞根），
 * 加上辭典標註的構詞關係（確定拆解、派生、同根），再依詞條家族分組。
 */

import type { DictionaryRelations } from './dictionary-relations.ts'
import { buildEntryGroups, mergeSpellings, type EntryGroup, type FamilyContext } from './family.ts'
import { decodePosting, type DocSummary, type MatchKind } from './format.ts'
import type { MethodTally } from './method-tally.ts'
import { alternativesOf, compareHits, recordScore, replacesRecordHit, termScore, type MatchType } from './scoring.ts'
import type { EntryHit, TermMatch } from './types.ts'

/** 詞條命中需要的搜尋引擎部分 */
export interface EntryContext {
  doc(k: number): DocSummary
  readonly relations: DictionaryRelations
}

/**
 * 每筆記錄取最好的命中（replacesRecordHit）。
 *
 * 每個詞依序試它的命中與被它取代的命中（alternativesOf），用第一個沒被排除的搜尋方法。
 * 辭典標註的構詞關係只從寫法與查詢相同的詞條展開（例句同一條規則，見 occurrence-search.ts）。
 *
 * @param key 整個查詢的搜尋鍵
 * @param terms 整個查詢的命中（TermMatcher.match）
 * @param accept 篩選條件
 * @param tally 記下每種搜尋方法找得到的記錄，並決定命中是否保留
 * @returns 記錄編號 → 命中
 */
export function collectEntries(ctx: EntryContext, key: string, terms: TermMatch[], accept: (k: number) => boolean, tally: MethodTally): Map<number, EntryHit> {
  const entries = new Map<number, EntryHit>()
  for (const t of terms) {
    for (const code of t.payloads as number[]) {
      const { doc: k, kind } = decodePosting(code)
      if (kind === 'token' || !accept(k)) continue
      let chosen: TermMatch | null = null
      for (const c of alternativesOf(t)) {
        if (!usablePosting(c.matchType, kind)) continue
        if (tally.admit(k, { matchType: c.matchType, distance: c.distance, kind }) && !chosen) chosen = c
      }
      if (!chosen) continue
      const prev = entries.get(k)
      const hit: EntryHit = {
        doc: prev?.doc ?? ctx.doc(k),
        term: chosen.term,
        distance: chosen.distance,
        // 詞根 posting 是辭典標註的派生關係：排在詞本身之後（與辭典的其他構詞關係同一條規則，scoring.ts）
        score: recordScore(termScore(chosen, key), kind === 'root' ? 1 : 0),
        matchType: chosen.matchType,
        kind,
        direct: kind !== 'root' || Boolean(prev?.direct),
        alignment: null,
        analysis: chosen.analysis ?? null,
        ...(chosen.csr ? { csr: chosen.csr } : {}),
      }
      if (replacesRecordHit(hit, prev, compareHits)) entries.set(k, hit)
      else if (hit.direct && prev) prev.direct = true
    }
  }
  // 辭典標註的構詞關係（確定拆解、派生、同根）：只從寫法與查詢相同的詞條展開
  for (const t of terms) {
    if (t.matchType !== 'fuzzy' || t.distance > 0) continue
    for (const r of ctx.relations.of(t)) {
      if (!accept(r.doc) || !tally.admit(r.doc, { matchType: 'fuzzy', distance: 0, kind: r.kind })) continue
      const prev = entries.get(r.doc)
      const hit: EntryHit = {
        doc: prev?.doc ?? ctx.doc(r.doc),
        term: t.term,
        distance: 0,
        score: recordScore(termScore(t, key), r.depth),
        matchType: 'fuzzy',
        kind: r.kind,
        ...(r.via ? { via: r.via } : {}),
        // 經由辭典關係的命中不是獨立的證據；原本已經直接命中的（例如自動拆解到的詞根）仍算
        direct: Boolean(prev?.direct),
        alignment: null,
        analysis: null,
      }
      if (replacesRecordHit(hit, prev, compareHits)) entries.set(r.doc, hit)
    }
  }
  return entries
}

/**
 * 詞條家族：辭典確認屬於同一個詞條的命中排在一起，詞根條目在最上面；
 * 寫法完全相同的單獨結果再合成同形詞組（family.ts）。
 * @param hits 已排序的詞條命中
 */
export function groupEntries(hits: EntryHit[], family: Omit<FamilyContext, 'compareHits'>): EntryGroup[] {
  return mergeSpellings(buildEntryGroups(hits, { ...family, compareHits }))
}

/**
 * 哪些 posting 可以跟哪種命中方式搭配：
 * - 自動拆解（lemma）：詞根本身，以及辭典標註的派生詞（root posting，排在詞根之後）。
 *   查 kinawas 得到詞根 kawas 時，mukawas、maakawas 等已標註的派生詞也要列出來
 * - 自動派生（derived）、自動同根（sibling）：不沿用 root posting，那是「派生詞的派生詞」
 * - 其他（完全相符、相近拼寫、開頭相符、結尾相符、包含）：沿用，關係是確定派生（fuzzy）或以把握較小的那一種計（scoring.ts 的 methodOf）
 */
function usablePosting(matchType: MatchType, kind: MatchKind): boolean {
  if (matchType === 'derived' || matchType === 'sibling') return kind !== 'root'
  return true
}
