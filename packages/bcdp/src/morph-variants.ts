/**
 * @file 構詞搜尋的還原變體：在查詢上拿掉中綴或重疊部分（docs/bcdp.md 1.4）。
 *
 * 中綴、重疊是查詢上的模板（重疊複製的是查詢中的形式），所以先在查詢上還原，每一種拿法是一個通道；
 * 變體的交界固定在查詢的位置上：詞幹由固定的起點開始（規則不跨越），並在允許的位置結束。
 */

import { EDGE_JUNCTION, EDGE_WORD } from './dp.ts'
import type { ReduplicationPattern } from './morphology.ts'
import type { Level, MorphContext, OpUse, RestoredVariant } from './morph-types.ts'

/** 詞幹的一個起點：查詢位置 i、到這裡的成本、前面有沒有前綴鏈 */
interface StemStart {
  i: number
  startCost: number
  prefixed: boolean
}

/**
 * 還原變體：在每個可能的詞幹起點 i 拿掉中綴或重疊部分。詞幹的起點依用法而定：
 * - 單獨的中綴、重疊（或沒有外側前綴的環綴）：詞首（沒有前綴），或某條前綴鏈的終點；
 * - 外側緊貼前綴 outer 的包覆單位（m<a>-）：「前綴鏈 · outer」的終點，成本取自 outer 那一側的狀態
 *   （與前綴式環綴的左邊同一個量，circP）。
 * 拿掉中綴之後詞幹的首輔音必須不變：m ＋ <a> 因此只接元音開頭的詞幹（mausa），mabaket 不會被當成 m<a>- ＋ baket。
 * @param P 各層前綴合併後的狀態
 * @param circP 緊貼詞幹的前綴（依形式）接在前綴鏈之後的狀態
 * @param circS 對得上查詢結尾的環綴後綴
 */
export function* restored(ctx: MorphContext, chars: string[], P: Level, circP: Map<string, Level>, circS: { has: (suffix: string) => boolean }): Generator<RestoredVariant> {
  const { infixUses, redupUses, outers } = ctx
  const n = chars.length
  // 環綴的後綴對不上查詢的結尾時，這個用法不可能命中：先濾掉，不必試
  const usable = (u: OpUse) => !u.circumfix?.suffix || circS.has(u.circumfix.suffix)
  for (const outer of outers) {
    const xs = infixUses.filter((u) => u.outer === outer && usable(u))
    const rs = redupUses.filter((u) => u.outer === outer && usable(u))
    const starts: StemStart[] = []
    if (!outer) {
      // 詞首（沒有前綴），或某條前綴鏈的終點（交界）。詞首與交界的語意不同（構詞音變只在交界適用），
      // 所以 i ＝ 0 時兩者都要試
      starts.push({ i: 0, startCost: 0, prefixed: false })
      for (let i = 0; i < n; i++) if (P.row[i] < Infinity) starts.push({ i, startCost: P.row[i], prefixed: true })
    } else {
      const Pc = circP.get(outer)
      if (Pc) for (let i = 0; i < n; i++) if (Pc.row[i] < Infinity) starts.push({ i, startCost: Pc.row[i], prefixed: true })
    }
    yield* restoredAt(ctx, chars, starts, xs, rs, outer)
  }
}

/**
 * 由給定的詞幹起點拿掉中綴或重疊部分（restored 的本體）。同一種拿法（同一個中綴形式、同一種重疊型式）
 * 只算一次，再給用到它的每個步驟各一個變體（單獨的中綴、重疊，與以它為左邊的環綴）。
 */
function* restoredAt(
  ctx: MorphContext,
  chars: string[],
  starts: StemStart[],
  xs: Array<OpUse & { form: string }>,
  rs: Array<OpUse & { pattern: ReduplicationPattern }>,
  outer: string,
): Generator<RestoredVariant> {
  const { analyzer, spec, isBoundary, junctionInserts } = ctx
  const n = chars.length
  const byForm = groupBy(xs, (x) => x.form)
  const byPattern = groupBy(rs, (r) => r.pattern)
  for (const { i, startCost, prefixed } of starts) {
    const head = Array.from(analyzer.onset(chars.slice(i).join('')))

    // 中綴：詞幹首輔音之後、首元音之前（首輔音不能含空白：構詞不跨越詞邊界）
    const at = i + head.length
    for (const [form, uses] of head.some(isBoundary) ? [] : byForm) {
      const infix = Array.from(form)
      if (chars.slice(at, at + infix.length).join('') !== form) continue
      const reduced = [...chars.slice(0, at), ...chars.slice(at + infix.length)]
      if (reduced.length - i < spec.minStem) continue
      if (analyzer.onset(reduced.slice(i).join('')) !== head.join('')) continue
      const ends = (e: number) => e > at // 詞幹必須越過中綴所在的位置
      for (const x of uses) {
        yield {
          kind: 'infix',
          chars: reduced,
          op: x.op(form),
          circumfix: x.circumfix,
          suffix: x.circumfix?.suffix || null,
          shape: `x|${prefixed}|${i}|${form}|${outer}`,
          start: i,
          startCost,
          prefixed,
          outer,
          rank: x.rank,
          startEdge: prefixed ? EDGE_JUNCTION : EDGE_WORD,
          cut: at,
          len: infix.length,
          ends,
        }
      }
    }

    // 重疊：詞幹前面的重疊部分，試每一種長度。模板只套用在詞幹上，而且詞幹取自查詢，
    // 所以複製的是查詢（方言）的形式；詞幹的長度只能是模板正好產生重疊部分的那些。
    // 重疊部分與詞幹之間是交界：交界上的增生（junctionInserts）不算在詞幹裡。
    // 重疊的詞幹開頭一定是交界，i ＝ 0 時由前綴鏈出發只會更貴，不必另外試
    for (const [pattern, uses] of prefixed && i === 0 ? [] : byPattern) {
      for (let len = 1; i + len < n; len++) {
        if (n - i - len < spec.minStem) break
        if (isBoundary(chars[i + len - 1])) break // 重疊部分不跨越空白
        const red = chars.slice(i, i + len).join('')
        const starts = [i + len]
        for (const g of junctionInserts) if (chars.slice(i + len, i + len + g.length).join('') === g.join('')) starts.push(i + len + g.length)
        for (const s of starts) {
          const base = chars.slice(s)
          if (base.length < spec.minStem) continue
          const lengths = analyzer.reduplicantStems(pattern, base, red)
          if (!lengths.length) continue
          const stemEnds = new Set(lengths.map((l) => s - len + l)) // 還原後的查詢上的位置
          const reduced = [...chars.slice(0, i), ...chars.slice(i + len)]
          const ends = (e: number) => stemEnds.has(e)
          for (const r of uses) {
            yield {
              kind: 'reduplication',
              chars: reduced,
              op: r.op(red),
              circumfix: r.circumfix,
              suffix: r.circumfix?.suffix || null,
              shape: `r|${prefixed}|${i}|${len}|${s}|${pattern}|${outer}`,
              start: i,
              startCost,
              prefixed,
              outer,
              rank: r.rank,
              startEdge: EDGE_JUNCTION,
              cut: i,
              len,
              ends,
            }
          }
        }
      }
    }
  }
}

/** 依鍵分組（保留第一次出現的順序）。 */
function groupBy<T, K>(list: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of list) {
    const k = key(item)
    const group = out.get(k)
    if (group) group.push(item)
    else out.set(k, [item])
  }
  return out
}
