/**
 * @file BCDP 模型的窮舉參考實作（測試用的仲裁者）。
 *
 * 完全依照 docs/bcdp.md 第 1 節的定義，直接列舉所有「分析」：
 *   前綴鏈 π ·（中綴或重疊 ω，或緊貼詞幹的環綴）· 詞根 t · 後綴鏈 σ
 * 每個分析的成本是步驟成本的和，加上查詢與整個底層字串 π·t·σ 的聯合對齊（ref-joint.js：
 * 規則可以跨越交界、詞首詞尾規則與構詞音變在交界適用、空白只能在詞幹內消耗），再加上詞根依音節數的成本
 * （rootSyllableCost；總成本上限比的是不含它的成本，lemmaSpread 比的是含它的成本，docs/bcdp.md 1.6 第 9 項）。
 * 中綴、重疊是查詢上的模板：在查詢上拿掉，交界固定在查詢的位置上（ref-joint 的 pinIn／pinOut）。
 * 不用交界狀態、不用詞綴 trie、不用詞圖、不剪枝、不合併；重疊模板也以正規表示式另外寫一份。
 *
 * 與正式實作共用的部分（誠實列出）：
 * - 規格的正規化與預設值（createAnalyzer(...).spec）
 * - 規則的展開與成本表（refJointContext 取自 metric.ruleSet.expand、metric.costs）
 * 比對的粒度是「每個詞根的成本」，不比較說明中選了哪一條詞綴鏈（同分時的選擇另有固定案例）。
 *
 * 只適合小輸入：成本是指數級的。
 */

import { refJoint } from './ref-joint.js'

const EPS = 1e-9

/**
 * @param {ReturnType<typeof import('./ref-joint.js').refJointContext>} ctx
 * @param {object} input
 * @param {string} input.query 已正規化的查詢
 * @param {string[]} input.lexicon 詞庫
 * @param {any} input.spec createAnalyzer(...).spec（已正規化、已補預設值）
 * @param {number} input.maxDistance 總成本上限
 * @param {Map<string, string>} [input.why] 除錯用：記下每個詞根的最佳分析
 * @param {Record<string, number | {entry: number, other: number}>} [input.rootSyllableCost] 設定檔原本的寫法
 *   （音節數 → 成本，或依詞根是不是辭典的詞條分兩種；最大的鍵也套用到更多音節）
 * @param {(term: string) => boolean} [input.isEntry] 詞根是不是辭典的詞條（省略時一律是）
 * @returns {Map<string, number>} 詞根 → 最小成本（lemmaSpread 截斷後）
 */
export function refMorph(ctx, { query, lexicon, spec, maxDistance, why, rootSyllableCost, isEntry = () => true }) {
  const q = Array.from(query)
  const n = q.length
  /** @type {Map<string, number>} */
  const best = new Map()
  // 查詢至少要比 minStem 多一個字元
  if (n < spec.minStem + 1) return best
  const isB = (/** @type {string} */ ch) => ctx.boundaries.has(ch)
  const vowels = new Set(Array.from(spec.vowels))
  const reduplicant = refTemplate(spec.vowels, spec.glides ?? '')
  // 交界上只動查詢的規則：target 為空、不限詞尾（重疊部分與詞幹之間也是交界）
  const inserts = [...new Set(ctx.rules.filter((r) => r.target.length === 0 && r.source.length > 0 && r.position !== 'final').map((r) => r.source.join('')))]

  /** @param {Array<{form: string, cost: number}>} list */
  const chainsOf = (list) => {
    /** @type {Array<Array<{form: string, cost: number}>>} */
    const out = [[]]
    let level = [[]]
    for (let s = 0; s < spec.maxSteps; s++) {
      level = level.flatMap((c) => list.map((a) => [...c, a]))
      out.push(...level)
    }
    return out
  }
  const prefixChains = chainsOf(spec.prefixes)
  const suffixChains = chainsOf(spec.suffixes) // 由內而外（詞中的順序）
  const sum = (/** @type {Array<{cost: number}>} */ list) => list.reduce((a, b) => a + b.cost, 0)
  const text = (/** @type {Array<{form: string}>} */ list) => list.map((a) => a.form).join('')

  /**
   * @param {string} t
   * @param {number} cost
   * @param {string} how
   */
  const put = (t, cost, how) => {
    if (cost > maxDistance + EPS) return
    const total = cost + rootCostOf(t)
    if (total < (best.get(t) ?? Infinity) - EPS) {
      best.set(t, total)
      why?.set(t, `${how} = ${Math.round(total * 1e9) / 1e9}`)
    }
  }
  /** 詞根依音節數的成本 @param {string} t */
  function rootCostOf(t) {
    if (!rootSyllableCost || !Object.keys(rootSyllableCost).length) return 0
    const syllables = Array.from(t).filter((ch) => vowels.has(ch)).length
    const keys = Object.keys(rootSyllableCost).map(Number)
    const key = Math.min(syllables, Math.max(...keys))
    const v = rootSyllableCost[String(key)] ?? 0
    return typeof v === 'number' ? v : v[isEntry(t) ? 'entry' : 'other']
  }

  const terms = lexicon.filter((t) => t !== query && Array.from(t).length >= spec.minStem)
  /**
   * 環綴（包覆單位）：null 表示沒有環綴。緊貼詞幹的前綴（前綴式的左邊，或中綴、重疊式外側的 outer）是最內層的前綴，
   * 後綴（可以沒有）是最內層的後綴；vowelStem 的環綴只接元音開頭的詞幹
   */
  const circumfixes = [null, ...(spec.circumfixes ?? [])]
  for (const t of terms) {
    const tc = Array.from(t)
    for (const pre of prefixChains) {
      for (const suf of suffixChains) {
        for (const c of circumfixes) {
          if (c?.vowelStem && !vowels.has(tc[0])) continue
          const left = c ? Array.from(c.kind === 'prefix' ? c.left : (c.outer ?? '')) : []
          const right = c ? Array.from(c.suffix) : []
          const p = [...Array.from(text(pre)), ...left]
          const J1 = p.length
          const J2 = J1 + tc.length
          // 每個詞素之間都是交界：前綴與前綴、前綴與詞幹、詞幹與後綴、後綴與後綴（環綴的兩側也是詞素）
          /** @type {number[]} */
          const junctions = []
          let at = 0
          for (const a of pre) junctions.push((at += Array.from(a.form).length))
          if (left.length) junctions.push(J1)
          at = J2
          if (right.length) {
            junctions.push(at)
            at += right.length
          }
          for (const a of suf) {
            junctions.push(at)
            at += Array.from(a.form).length
          }
          const u = [...p, ...tc, ...right, ...Array.from(text(suf))]
          const steps = sum(pre) + sum(suf) + (c?.cost ?? 0)
          // 音變的成本不小於 0：光是步驟就超過上限的分析不必算（只是省時間，結果不變）
          if (steps > maxDistance + EPS) continue
          const label = `${text(pre)}-${c ? `[${c.outer ?? ''}+${c.left}…${c.suffix}]` : ''}${t}-${text(suf)}`

          // 串接：至少一個詞綴（前綴式的環綴本身就是一個步驟）
          if ((c === null && pre.length + suf.length > 0) || c?.kind === 'prefix') {
            const d = refJoint(ctx, q, u, { junctions: [...new Set(junctions)], stem: [J1, J2] })
            put(t, steps + d, `${label}：${steps} + ${d}`)
          }

          // 還原變體：詞幹起點 i 固定在查詢上；沒有前綴時只能在詞首。
          // 環綴的中綴、重疊式只用它自己的左邊（成本已經算在 steps 裡），詞尾一定接它的後綴
          const infixes = c === null ? spec.infixes : c.kind === 'infix' ? [{ form: c.left, cost: 0 }] : []
          const reds = c === null ? spec.reduplication : c.kind === 'reduplication' ? [{ pattern: c.left, cost: 0 }] : []
          const hasSuffix = suf.length > 0 || right.length > 0
          for (let i = 0; i < n; i++) {
            if (p.length === 0 && i > 0) break
            // 中綴：詞幹首輔音之後、首元音之前；首輔音不含空白；拿掉後首輔音不變、剩下的至少 minStem 個字元
            let h = i
            while (h < n && !vowels.has(q[h])) h++
            const head = q.slice(i, h)
            if (!head.some(isB)) {
              for (const x of infixes) {
                if (steps + x.cost > maxDistance + EPS) continue
                const xs = Array.from(x.form)
                if (q.slice(h, h + xs.length).join('') !== x.form) continue
                const reduced = [...q.slice(0, h), ...q.slice(h + xs.length)]
                if (reduced.length - i < spec.minStem) continue
                let h2 = i
                while (h2 < reduced.length && !vowels.has(reduced[h2])) h2++
                if (h2 !== h) continue
                const allowed = new Set(Array.from({ length: reduced.length + 1 }, (_, e) => e).filter((e) => e > h))
                const d = refJoint(ctx, reduced, u, {
                  junctions,
                  stem: [J1, J2],
                  pinIn: { b: J1, a: i },
                  pinOut: { b: J2, allowed: hasSuffix ? allowed : new Set(allowed.has(reduced.length) ? [reduced.length] : []) },
                })
                put(t, steps + x.cost + d, `${text(pre)}-<${x.form}>${t}-${c ? c.suffix : ''}${text(suf)}：${steps + x.cost} + ${d}`)
              }
            }
            // 重疊：q[i..i+len) 是重疊部分（不含空白），詞幹的表面形式由 s（略過交界上的增生）開始
            for (const r of reds) {
              if (steps + r.cost > maxDistance + EPS) continue
              for (let len = 1; i + len < n; len++) {
                if (n - i - len < spec.minStem) break
                const red = q.slice(i, i + len)
                if (red.some(isB)) break
                const starts = [i + len]
                for (const g of inserts) if (q.slice(i + len, i + len + Array.from(g).length).join('') === g) starts.push(i + len + Array.from(g).length)
                for (const st of starts) {
                  const base = q.slice(st)
                  if (base.length < spec.minStem) continue
                  /** @type {number[]} */
                  const ends = []
                  for (let L = 1; L <= base.length; L++) if (reduplicant(r.pattern, base.slice(0, L).join('')) === red.join('')) ends.push(st - len + L)
                  if (!ends.length) continue
                  const reduced = [...q.slice(0, i), ...q.slice(i + len)]
                  const allowed = new Set(ends)
                  const d = refJoint(ctx, reduced, u, {
                    junctions: [...new Set([J1, ...junctions])], // 詞幹開頭是「重疊部分｜詞幹」的交界
                    stem: [J1, J2],
                    pinIn: { b: J1, a: i },
                    pinOut: { b: J2, allowed: hasSuffix ? allowed : new Set(allowed.has(reduced.length) ? [reduced.length] : []) },
                  })
                  put(t, steps + r.cost + d, `${text(pre)}-${red.join('')}~${t}-${c ? c.suffix : ''}${text(suf)}：${steps + r.cost} + ${d}`)
                }
              }
            }
          }
        }
      }
    }
  }
  if (best.size === 0) return best
  const cutoff = Math.min(...best.values()) + spec.lemmaSpread + EPS
  for (const [t, c] of best) if (c > cutoff) best.delete(t)
  return best
}

/**
 * 重疊模板的獨立寫法（bcdp.md 1.6 第 2 項、language-profile.md「重疊」）：以正規表示式直接寫出定義，
 * 不共用 src/fuzzy/morphology.js 的程式。V 是元音字母，C 是其他字元；元音核是連續的元音。
 * @param {string} vowels
 * @returns {(pattern: string, base: string) => string | null}
 */
function refTemplate(vowels, glides = '') {
  // 字元類別中有特殊意義的 \ ] ^ - 要跳脫
  const v = `[${Array.from(vowels).map((ch) => (/[\\\]^-]/.test(ch) ? `\\${ch}` : ch)).join('')}]`
  const c = `[^${v.slice(1, -1)}]`
  const re = (/** @type {string} */ body) => new RegExp(`^${body}`, 'u')
  return (pattern, base) => {
    if (pattern === 'full') return base
    if (pattern === 'Ca') return `${re(`${c}*`).exec(base)?.[0] ?? ''}a`
    if (pattern === 'CV') return re(`${c}*${v}`).exec(base)?.[0] ?? null
    if (pattern === 'CVV') {
      const m = re(`(${c}*)(${v})`).exec(base)
      return m ? m[1] + m[2] + m[2] : null
    }
    if (pattern === 'CGV' || pattern === 'CVG') {
      // 元音核正好兩個不同的元音（後面不是元音）；CGV 第一個是滑音，CVG 第二個是滑音而第一個不是
      const m = re(`(${c}*)(${v})(${v})(?!${v})`).exec(base)
      if (!m || m[2] === m[3]) return null
      const g1 = glides.includes(m[2])
      return (pattern === 'CGV' ? g1 : !g1 && glides.includes(m[3])) ? m[0] : null
    }
    if (pattern === 'CVCV') return re(`${c}*${v}+${c}+${v}+`).exec(base)?.[0] ?? null
    if (pattern === 'CVCVC') return re(`${c}*${v}+${c}+${v}+${c}*`).exec(base)?.[0] ?? null
    throw new RangeError(`未知的重疊型式 ${pattern}`)
  }
}
