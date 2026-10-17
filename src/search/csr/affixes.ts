/**
 * @file 對應組檢索的去詞綴：依語言設定檔的構詞規格，列出一個詞所有「剝掉詞綴」的分析（docs/csr.md 第 4.1 節）。
 *
 * 這裡刻意比 BCDP 的構詞搜尋簡單：對應組檢索只需要「可能的詞幹」與「剝了幾個詞綴」，排序交給加權 DP 與 λ。
 * - 前綴、後綴：規格中所有的形式（構詞文法的 morphemes，或平面清單的 prefixes、suffixes）；
 * - 中綴：至少兩個字元的（插在第一個輔音之後）；一個字元的中綴幾乎任何詞都剝得掉，太容易誤剝，不用；
 * - 重疊：CV、CVV、Ca、CVCV、CVCVC 中規格有列的（其他型式不用）；
 * - 交界：構詞音變（alternations）還原——詞素末（final）的表面形式在剝掉後綴後換回底層形式（kabad-an → kabat），
 *   前綴本身也試它套上詞素末構詞音變的寫法（tau ＋ ' → tau'-alaw）；詞首（initial）的構詞音變反過來。
 *   位置為 initial、一邊是空字串的方言規則（例如喉塞音的有無）也當成交界的增生：剝前綴後的詞幹可以去掉它，後綴前面也可以多它；
 * - 至多兩步、每一種（前綴、後綴、中綴、重疊）至多一次，詞幹至少 minStem 個字元。
 */

import type { LanguageProfile } from '#bcdp'

/** 剝掉的一個詞綴 */
export interface CsrAffix {
  type: 'prefix' | 'suffix' | 'infix' | 'reduplication'
  form: string
}

/** 一個分析：剩下的詞幹、剝掉的詞綴（由外而內） */
export interface CsrAnalysis {
  stem: string
  affixes: CsrAffix[]
}

const DEFAULT_VOWELS = 'aeiouéə'
const SUPPORTED_REDUPLICATION = new Set(['CV', 'CVV', 'Ca', 'CVCV', 'CVCVC'])

interface Spec {
  vowels?: string
  minStem?: number
  prefixes?: Array<{ form: string }>
  suffixes?: Array<{ form: string }>
  infixes?: Array<{ form: string }>
  reduplication?: Array<{ pattern: string }>
  morphemes?: Array<{ type: string; form?: string; forms?: string[]; pattern?: string }>
  alternations?: Array<{ underlying: string; surface: string; position?: string }>
}

/**
 * @param normalize 與詞庫相同的正規化（搜尋鍵），詞綴與構詞音變的寫法也先正規化
 */
export function createAffixStripper(profile: LanguageProfile, normalize: (s: string) => string) {
  const spec = (profile.morphology ?? {}) as Spec
  const uniq = (xs: string[]) => [...new Set(xs.map(normalize).filter((x) => x.length > 0))]
  const ofType = (type: string) => (spec.morphemes ?? []).filter((m) => m.type === type)
  const formsOf = (list: Array<{ form?: string; forms?: string[] }>) => list.flatMap((m) => m.forms ?? (m.form ? [m.form] : []))
  const prefixes = uniq([...formsOf(ofType('prefix')), ...(spec.prefixes ?? []).map((a) => a.form)])
  const suffixes = uniq([...formsOf(ofType('suffix')), ...(spec.suffixes ?? []).map((a) => a.form)])
  const infixes = uniq([...formsOf(ofType('infix')), ...(spec.infixes ?? []).map((a) => a.form)]).filter((f) => Array.from(f).length >= 2)
  const patterns = new Set(
    [...ofType('reduplication').map((m) => m.pattern ?? ''), ...(spec.reduplication ?? []).map((r) => r.pattern)].filter((p) => SUPPORTED_REDUPLICATION.has(p)),
  )
  const vowels = new Set(Array.from(normalize(spec.vowels ?? DEFAULT_VOWELS)))
  const minStem = spec.minStem ?? 3
  const alternations = (spec.alternations ?? []).map((a) => ({ underlying: normalize(a.underlying), surface: normalize(a.surface), position: a.position ?? 'final' }))
  const finals = alternations.filter((a) => a.position === 'final' || a.position === 'any')
  const initials = alternations.filter((a) => a.position === 'initial' || a.position === 'any')
  // 交界的增生：位置為 initial、一邊是空字串的方言規則（例如 ' → ∅）
  const epenthetic = uniq(
    (profile.rules ?? []).flatMap((g) =>
      g.rules.flatMap((r) => {
        const o = Array.isArray(r) ? { source: r[0], target: r[1], position: undefined } : (r as { source: string; target: string; position?: string })
        const position = o.position ?? g.position ?? 'any'
        if (position !== 'initial') return []
        return o.source === '' ? [o.target] : o.target === '' ? [o.source] : []
      }),
    ),
  )
  const ok = (x: string) => Array.from(x).length >= minStem
  const isC = (c: string | undefined) => c !== undefined && !vowels.has(c)

  /** 前綴本身的寫法：原形，以及詞素末套上構詞音變的（tau → tau'） */
  const prefixForms = prefixes.map((p) => ({
    p,
    surfaces: [p, ...finals.filter((a) => a.underlying && p.endsWith(a.underlying)).map((a) => p.slice(0, p.length - a.underlying.length) + a.surface)],
  }))
  /** 後綴的寫法：原形、詞首套上構詞音變的、前面多交界增生的 */
  const suffixForms = suffixes.map((s) => ({
    s,
    surfaces: [s, ...initials.filter((a) => a.underlying && s.startsWith(a.underlying)).map((a) => a.surface + s.slice(a.underlying.length)), ...epenthetic.map((e) => e + s)],
  }))

  type Step = (x: string) => Array<[string, CsrAffix]>
  const stripP: Step = (x) => {
    const out: Array<[string, CsrAffix]> = []
    for (const { p, surfaces } of prefixForms)
      for (const sp of new Set(surfaces)) {
        if (!x.startsWith(sp)) continue
        const r = x.slice(sp.length)
        const rs = [r, ...initials.filter((a) => a.surface && r.startsWith(a.surface)).map((a) => a.underlying + r.slice(a.surface.length)), ...epenthetic.filter((e) => r.startsWith(e)).map((e) => r.slice(e.length))]
        for (const v of rs) if (ok(v)) out.push([v, { type: 'prefix', form: p }])
      }
    return out
  }
  const stripS: Step = (x) => {
    const out: Array<[string, CsrAffix]> = []
    for (const { s, surfaces } of suffixForms)
      for (const ss of new Set(surfaces)) {
        if (!x.endsWith(ss)) continue
        const st = x.slice(0, x.length - ss.length)
        const sts = [st, ...finals.filter((a) => a.surface && st.endsWith(a.surface)).map((a) => st.slice(0, st.length - a.surface.length) + a.underlying)]
        for (const v of sts) if (ok(v)) out.push([v, { type: 'suffix', form: s }])
      }
    return out
  }
  const stripI: Step = (x) => {
    const ch = Array.from(x)
    const out: Array<[string, CsrAffix]> = []
    if (!isC(ch[0])) return out
    const rest = ch.slice(1).join('')
    for (const inf of infixes) if (rest.startsWith(inf)) {
      const v = ch[0] + rest.slice(inf.length)
      if (ok(v)) out.push([v, { type: 'infix', form: inf }])
    }
    return out
  }
  const stripR: Step = (x) => {
    const c = Array.from(x)
    const out: Array<[string, CsrAffix]> = []
    if (!isC(c[0])) return out
    const push = (k: number) => {
      const v = c.slice(k).join('')
      if (ok(v)) out.push([v, { type: 'reduplication', form: c.slice(0, k).join('') }])
    }
    const same = (i: number, j: number, n: number) => c.length >= j + n && c.slice(i, i + n).join('') === c.slice(j, j + n).join('')
    if (patterns.has('CV') && vowels.has(c[1]) && same(0, 2, 2)) push(2) // ki~kiliw
    if (patterns.has('CVV') && vowels.has(c[1]) && c[2] === c[1] && same(0, 3, 2)) push(3) // luu~luzuax
    if (patterns.has('Ca') && c[1] === 'a' && c[2] === c[0] && c[3] !== 'a') push(2) // ta~tuba
    if (patterns.has('CVCV') && same(0, 4, 4)) push(4)
    if (patterns.has('CVCVC') && same(0, 5, 5)) push(5)
    return out
  }
  const OPS = [stripP, stripS, stripI, stripR]

  /** 所有分析（含詞本身）：詞幹 → 剝最少詞綴的那一個分析 */
  const analyses = (word: string): Map<string, CsrAnalysis> => {
    const out = new Map<string, CsrAnalysis>([[word, { stem: word, affixes: [] }]])
    const add = (stem: string, affixes: CsrAffix[]) => {
      const prev = out.get(stem)
      if (!prev || affixes.length < prev.affixes.length) out.set(stem, { stem, affixes })
    }
    OPS.forEach((op1, i) => {
      for (const [x, a1] of op1(word)) {
        add(x, [a1])
        OPS.forEach((op2, j) => {
          if (j !== i) for (const [y, a2] of op2(x)) add(y, [a1, a2])
        })
      }
    })
    return out
  }
  return { analyses, counts: { prefixes: prefixes.length, suffixes: suffixes.length, infixes: infixes.length, reduplication: patterns.size } }
}
