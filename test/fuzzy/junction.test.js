/**
 * 交界狀態（docs/bcdp.md 第 4 節）的性質測試：一段一段走、以交界狀態銜接的結果，
 * 必須等於把整個底層字串當作一個詞、依定義直接算的聯合對齊（ref-joint.js）。
 *
 * - 前綴 → 詞幹：前一段的交界狀態當作後一段的起點（跨界規則由跨界表延續）
 * - 詞幹 → 後綴：後綴由反方向（鏡像距離函式）算好，詞尾耦合
 * - 合併：兩條前綴鏈的交界狀態逐項取 min，等於分開算再取 min（(min, +) 線性）
 */

import { describe, expect, it } from 'vitest'
import { EPSILON, FuzzyIndex, RuleSet, WeightedEditDistance } from '../../src/fuzzy/index.js'
import { emptyJunction, mergeInto, toForwardEnd } from '../../src/fuzzy/junction.js'
import { createRandom, pick, randomString } from './helpers.js'
import { refJoint, refJointContext } from './reference/ref-joint.js'

const letters = ['a', 'b', 'k', 'g', "'"]

/** 隨機規則：多字元（target 最長 3，可以跨越交界）、位置限制、構詞音變 @param {() => number} random */
function randomMetric(random) {
  const rules = new RuleSet()
  const count = 2 + Math.floor(random() * 6)
  for (let k = 0; k < count; k++) {
    const source = randomString(random, letters, 0, 2)
    const target = randomString(random, letters, source ? 0 : 1, 3)
    if (source === target) continue
    const junction = random() < 0.2
    rules.add(source, target, pick(random, [0.1, 0.2, 0.3]), {
      position: pick(random, ['any', 'any', 'any', 'initial', 'final']),
      bidirectional: !junction && random() < 0.7,
      junction,
    })
  }
  return new WeightedEditDistance({
    rules,
    normalize: (s) => s,
    costs: { substitute: 1, delete: 0.7, insert: 0.6, overrides: { ' ': { substitute: 0.1, delete: 0.1, insert: 0.1 } } },
  })
}

/**
 * 在只含一個詞 form 的索引上走一段，回傳詞尾的交界狀態。
 * @param {WeightedEditDistance} metric
 * @param {string} form
 * @param {string[]} x
 * @param {import('../../src/fuzzy/fuzzy-index.js').JunctionState | undefined} from
 */
function walk(metric, form, x, from) {
  /** @type {import('../../src/fuzzy/fuzzy-index.js').JunctionState | null} */
  let state = null
  new FuzzyIndex(metric).addAll([[form, form]]).searchChannels([
    { query: x, options: { maxDistance: 1e9, from, lockBoundary: true, onJunction: (_t, s) => (state = s) } },
  ])
  return state
}

/**
 * 在只含一個詞 stem 的索引上走詞幹，回傳整個詞的成本。
 * @param {WeightedEditDistance} metric
 * @param {string} stem
 * @param {string[]} x
 * @param {any} options from／to／maxDistance
 */
function stemCost(metric, stem, x, options) {
  const [results] = new FuzzyIndex(metric).addAll([[stem, stem]]).searchChannels([{ query: x, options: { maxDistance: 1e9, ...options } }])
  return results[0]?.distance ?? Infinity
}

/** 由底層字串造查詢：隨機改幾個字元，偶爾插入空白 @param {() => number} random @param {string} u */
function queryFrom(random, u) {
  const q = Array.from(u)
  const edits = Math.floor(random() * 3)
  for (let e = 0; e < edits; e++) {
    const at = Math.floor(random() * (q.length + 1))
    const op = random()
    if (op < 0.4) q.splice(at, 0, pick(random, letters))
    else if (op < 0.7 && q.length > 1) q.splice(Math.min(at, q.length - 1), 1)
    else if (q.length) q[Math.min(at, q.length - 1)] = pick(random, letters)
  }
  if (random() < 0.2 && q.length > 2) q.splice(1 + Math.floor(random() * (q.length - 2)), 0, ' ')
  return q
}

const close = (/** @type {number} */ a, /** @type {number} */ b) => (a === Infinity ? b === Infinity : Math.abs(a - b) <= EPSILON)

/**
 * 刻意造出跨界的情形：挑一條 target 長 ≥ 2、沒有位置限制的規則，把 target 切成兩半放在交界兩側，
 * 查詢在那裡寫成 source。回傳 [左邊的詞素, 右邊的詞素, 查詢]；沒有合適的規則時回傳 null。
 * @param {() => number} random
 * @param {WeightedEditDistance} metric
 * @param {string} left 左邊詞素的開頭（target 的前半段接在後面）
 * @param {string} right 右邊詞素的結尾（接在 target 的後半段後面）
 */
function planted(random, metric, left, right) {
  // 一半用構詞音變：target 放在交界的一側（initial 在右、final 在左、any 任一側）
  const junctionRules = metric.ruleSet.expand().filter((r) => r.junction)
  if (junctionRules.length && random() < 0.5) {
    const r = pick(random, junctionRules)
    const onLeft = r.position === 'final' || (r.position === 'any' && random() < 0.5)
    const a = left + (onLeft ? r.target : '')
    const b = (onLeft ? '' : r.target) + right
    return [a, b, Array.from(left + r.source + right)]
  }
  const candidates = metric.ruleSet.expand().filter((r) => Array.from(r.target).length >= 2 && r.position === 'any' && !r.junction)
  if (!candidates.length) return null
  const r = pick(random, candidates)
  const target = Array.from(r.target)
  const cut = 1 + Math.floor(random() * (target.length - 1))
  const a = left + target.slice(0, cut).join('')
  const b = target.slice(cut).join('') + right
  return [a, b, Array.from(left + r.source + right)]
}

describe('交界狀態：一段一段走 ＝ 整個詞的聯合對齊', () => {
  it.each([1, 2, 3])('前綴 → 詞幹：交界狀態當作起點（種子 %i）', (seed) => {
    const random = createRandom(seed * 7919)
    let finite = 0
    for (let round = 0; round < 300; round++) {
      const metric = randomMetric(random)
      const ctx = refJointContext(metric)
      const p = randomString(random, letters, 1, 3)
      const t = randomString(random, letters, 1, 4)
      const x = queryFrom(random, p + t)
      const state = walk(metric, p, x, undefined)
      const got = state ? stemCost(metric, t, x, { from: state }) : Infinity
      const want = refJoint(ctx, x, Array.from(p + t), { junctions: [p.length], stem: [p.length, p.length + t.length] })
      expect(close(got, want), `p=${p} t=${t} x=${x.join('')} rules=${JSON.stringify(ctx.rules)}：${got} ≠ ${want}`).toBe(true)
      if (want < Infinity) finite++
    }
    expect(finite).toBeGreaterThan(200)
  })

  it.each([1, 2, 3])('詞幹 → 後綴：後綴由反方向算好，詞尾耦合（種子 %i）', (seed) => {
    const random = createRandom(seed * 104723)
    for (let round = 0; round < 300; round++) {
      const metric = randomMetric(random)
      const mirror = metric.mirror()
      const ctx = refJointContext(metric)
      const t = randomString(random, letters, 1, 4)
      const s = randomString(random, letters, 1, 3)
      const x = queryFrom(random, t + s)
      const back = walk(mirror, Array.from(s).reverse().join(''), [...x].reverse(), undefined)
      const got = back ? stemCost(metric, t, x, { to: toForwardEnd(back, mirror.compiled) }) : Infinity
      const want = refJoint(ctx, x, Array.from(t + s), { junctions: [t.length], stem: [0, t.length] })
      expect(close(got, want), `t=${t} s=${s} x=${x.join('')} rules=${JSON.stringify(ctx.rules)}：${got} ≠ ${want}`).toBe(true)
    }
  })

  it.each([1, 2, 3])('前綴 · 詞幹 · 後綴，兩個交界都可以被規則跨越（種子 %i）', (seed) => {
    const random = createRandom(seed * 3571)
    // reaching check：跨界表與構詞音變真的影響過結果
    let crossed = 0
    let junctionRule = 0
    for (let round = 0; round < 300; round++) {
      const metric = randomMetric(random)
      const mirror = metric.mirror()
      const ctx = refJointContext(metric)
      let p = randomString(random, letters, 1, 3)
      let t = randomString(random, letters, 1, 4)
      let s = randomString(random, letters, 1, 3)
      let x = queryFrom(random, p + t + s)
      // 一半的回合刻意讓規則跨越前綴｜詞幹或詞幹｜後綴的交界
      const plant = random() < 0.5 ? planted(random, metric, randomString(random, letters, 0, 2), randomString(random, letters, 0, 2)) : null
      if (plant && random() < 0.5) {
        ;[p, t] = plant
        x = [...plant[2], ...s]
      } else if (plant) {
        ;[t, s] = plant
        x = [...p, ...plant[2]]
      }
      if (!p || !t || !s) continue
      const front = walk(metric, p, x, undefined)
      const back = walk(mirror, Array.from(s).reverse().join(''), [...x].reverse(), undefined)
      const to = back && toForwardEnd(back, mirror.compiled)
      const got = front && to ? stemCost(metric, t, x, { from: front, to }) : Infinity
      const options = { junctions: [p.length, p.length + t.length], stem: /** @type {[number, number]} */ ([p.length, p.length + t.length]) }
      const want = refJoint(ctx, x, Array.from(p + t + s), options)
      expect(close(got, want), `p=${p} t=${t} s=${s} x=${x.join('')} rules=${JSON.stringify(ctx.rules)}：${got} ≠ ${want}`).toBe(true)
      if (front && to && got < stemCost(metric, t, x, { from: { ...front, pending: [] }, to: { ...to, pending: [] } }) - EPSILON) crossed++
      if (want < refJoint({ ...ctx, rules: ctx.rules.filter((r) => !r.junction) }, x, Array.from(p + t + s), options) - EPSILON) junctionRule++
    }
    expect(crossed).toBeGreaterThan(10)
    expect(junctionRule).toBeGreaterThan(10)
  })

  it('兩個前綴的鏈：前綴 · 前綴 · 詞幹，交界狀態一段接一段', () => {
    const random = createRandom(4241)
    for (let round = 0; round < 300; round++) {
      const metric = randomMetric(random)
      const ctx = refJointContext(metric)
      const p1 = randomString(random, letters, 1, 2)
      const p2 = randomString(random, letters, 1, 2)
      const t = randomString(random, letters, 1, 4)
      const x = queryFrom(random, p1 + p2 + t)
      const s1 = walk(metric, p1, x, undefined)
      const s2 = s1 && walk(metric, p2, x, s1)
      const got = s2 ? stemCost(metric, t, x, { from: s2 }) : Infinity
      const J1 = p1.length
      const J2 = J1 + p2.length
      const want = refJoint(ctx, x, Array.from(p1 + p2 + t), { junctions: [J1, J2], stem: [J2, J2 + t.length] })
      expect(close(got, want), `p=${p1}|${p2} t=${t} x=${x.join('')} rules=${JSON.stringify(ctx.rules)}：${got} ≠ ${want}`).toBe(true)
    }
  })

  it('合併：兩條前綴鏈的交界狀態逐項取 min ＝ 分開算再取 min', () => {
    const random = createRandom(8117)
    for (let round = 0; round < 300; round++) {
      const metric = randomMetric(random)
      const ctx = refJointContext(metric)
      const pa = randomString(random, letters, 1, 3)
      const pb = randomString(random, letters, 1, 3)
      const t = randomString(random, letters, 1, 4)
      const x = queryFrom(random, pick(random, [pa, pb]) + t)
      const merged = emptyJunction(x.length)
      for (const [p, tag] of [
        [pa, 'a'],
        [pb, 'b'],
      ]) {
        const s = walk(metric, p, x, undefined)
        if (s) mergeInto(merged, s, 0, tag)
      }
      const got = stemCost(metric, t, x, { from: merged })
      const want = Math.min(
        ...[pa, pb].map((p) => refJoint(ctx, x, Array.from(p + t), { junctions: [p.length], stem: [p.length, p.length + t.length] })),
      )
      expect(close(got, want), `pa=${pa} pb=${pb} t=${t} x=${x.join('')}：${got} ≠ ${want}`).toBe(true)
    }
  })

  it('explainSegments：整個詞的說明與聯合對齊相同，對齊各步的成本加起來等於距離', () => {
    const random = createRandom(6007)
    let checked = 0
    for (let round = 0; round < 300; round++) {
      const metric = randomMetric(random)
      const ctx = refJointContext(metric)
      const p = randomString(random, letters, 1, 3)
      const t = randomString(random, letters, 1, 4)
      const s = randomString(random, letters, 1, 3)
      const x = queryFrom(random, p + t + s)
      const e = metric.explainSegments(x, [
        { chars: Array.from(p), lock: true },
        { chars: Array.from(t) },
        { chars: Array.from(s), lock: true },
      ])
      const want = refJoint(ctx, x, Array.from(p + t + s), { junctions: [p.length, p.length + t.length], stem: [p.length, p.length + t.length] })
      expect(close(e.distance, want), `p=${p} t=${t} s=${s} x=${x.join('')}：${e.distance} ≠ ${want}`).toBe(true)
      if (want === Infinity) continue
      checked++
      const sum = e.alignment.reduce((a, step) => a + step.cost, 0)
      expect(sum).toBeCloseTo(e.distance, 9)
      expect(e.path[0]).toEqual([0, 0])
    }
    expect(checked).toBeGreaterThan(200)
  })

  it('explainSegments 的固定交界 ＝ 聯合對齊「經過指定的格子」', () => {
    const random = createRandom(6011)
    for (let round = 0; round < 300; round++) {
      const metric = randomMetric(random)
      const ctx = refJointContext(metric)
      const p = randomString(random, letters, 1, 2)
      const t = randomString(random, letters, 1, 4)
      const s = randomString(random, letters, 1, 2)
      const x = queryFrom(random, p + t + s)
      const at = Math.floor(random() * (x.length + 1))
      const allowed = new Set([Math.floor(random() * (x.length + 1)), Math.floor(random() * (x.length + 1))])
      const e = metric.explainSegments(
        x,
        [
          { chars: Array.from(p), lock: true },
          { chars: Array.from(t) },
          { chars: Array.from(s), lock: true },
        ],
        { pinStart: { segment: 1, x: at }, pinEnd: { segment: 1, allowed } },
      )
      const J1 = p.length
      const J2 = J1 + t.length
      const want = refJoint(ctx, x, Array.from(p + t + s), {
        junctions: [J1, J2],
        stem: [J1, J2],
        pinIn: { b: J1, a: at },
        pinOut: { b: J2, allowed },
      })
      expect(close(e.distance, want), `p=${p} t=${t} s=${s} x=${x.join('')} at=${at} allowed=${[...allowed]}：${e.distance} ≠ ${want}`).toBe(true)
      const sum = e.alignment.reduce((a, step) => a + step.cost, 0)
      if (want < Infinity) expect(Math.abs(sum - e.distance) < 1e-9, `p=${p} t=${t} s=${s} x=${x.join("")} at=${at} allowed=${[...allowed]} sum=${sum} d=${e.distance} path=${JSON.stringify(e.path)} steps=${e.alignment.map((a) => `${a.op}:${a.source}>${a.target}@${a.cost}`)}`).toBe(true)
    }
  })

  it('剪枝：上限內的結果與不剪枝相同', () => {
    const random = createRandom(9203)
    for (let round = 0; round < 200; round++) {
      const metric = randomMetric(random)
      const mirror = metric.mirror()
      const p = randomString(random, letters, 1, 3)
      const s = randomString(random, letters, 1, 3)
      const words = [...new Set(Array.from({ length: 30 }, () => randomString(random, letters, 1, 5)))]
      const x = queryFrom(random, p + pick(random, words) + s)
      const front = walk(metric, p, x, undefined)
      const back = walk(mirror, Array.from(s).reverse().join(''), [...x].reverse(), undefined)
      if (!front || !back) continue
      const to = toForwardEnd(back, mirror.compiled)
      const index = new FuzzyIndex(metric).addAll(words.map((w) => [w, w]))
      const bound = pick(random, [0.3, 0.6, 1])
      const [pruned] = index.searchChannels([{ query: x, options: { maxDistance: bound, from: front, to } }])
      const [all] = index.searchChannels([{ query: x, options: { maxDistance: 1e9, from: front, to } }])
      const expected = all.filter((r) => r.distance <= bound + EPSILON).map((r) => `${r.term}@${r.distance}`).sort()
      expect(pruned.map((r) => `${r.term}@${r.distance}`).sort()).toEqual(expected)
    }
  })
})

describe('jointDistance（衍生形方向的驗證）', () => {
  it('前綴 · 詞幹 · 後綴的聯合對齊 ＝ ref-joint；上限內相等，超過上限時也超過', () => {
    const random = createRandom(6007)
    let same = 0
    let crossing = 0
    for (let round = 0; round < 400; round++) {
      const metric = randomMetric(random)
      const ctx = refJointContext(metric)
      let p = randomString(random, letters, 1, 2)
      let t = randomString(random, letters, 1, 3)
      const s = randomString(random, letters, 1, 2)
      let x = queryFrom(random, p + t + s)
      // 一半刻意在前綴與詞幹的交界上放一條規則（跨界或構詞音變）
      const plant = random() < 0.5 ? planted(random, metric, p, t + s) : null
      if (plant) {
        ;[p, t] = [plant[0], plant[1].slice(0, plant[1].length - s.length)]
        x = plant[2]
        crossing++
      }
      if (!t) continue
      const segments = [
        { chars: Array.from(p), lock: true },
        { chars: Array.from(t), lock: false },
        { chars: Array.from(s), lock: true },
      ]
      const J1 = Array.from(p).length
      const J2 = J1 + Array.from(t).length
      const want = refJoint(ctx, x, Array.from(p + t + s), { junctions: [J1, J2], stem: [J1, J2] })
      const bound = pick(random, [0.2, 0.5, Infinity])
      const got = metric.jointDistance(x, segments, bound)
      if (x.join('') === p + t + s) same++
      if (want <= bound + EPSILON) expect(close(got, want), `p=${p} t=${t} s=${s} x=${x.join('')}：${got} ≠ ${want} rules=${JSON.stringify(ctx.rules)} bound=${bound}`).toBe(true)
      else expect(got, `p=${p} t=${t} s=${s} x=${x.join('')}：${got} 應超過 ${bound}（ref ${want}）`).toBeGreaterThan(bound + EPSILON)
    }
    // reaching check：逐字相同（捷徑）與刻意跨界的情形都出現過
    expect(same).toBeGreaterThan(20)
    expect(crossing).toBeGreaterThan(50)
  })
})

describe('構詞音變只在詞素交界適用', () => {
  it('普通的距離（沒有交界）與拿掉構詞音變的距離函式相同；詞庫搜尋也相同', () => {
    const random = createRandom(4099)
    for (let round = 0; round < 40; round++) {
      const full = new RuleSet()
      const plain = new RuleSet()
      for (let k = 0; k < 5; k++) {
        const source = randomString(random, letters, 0, 2)
        const target = randomString(random, letters, source ? 0 : 1, 2)
        if (source === target) continue
        const junction = k < 2
        const options = { position: pick(random, ['any', 'initial', 'final']), junction }
        full.add(source, target, 0.05, options)
        if (!junction) plain.add(source, target, 0.05, options)
      }
      const make = (/** @type {RuleSet} */ rules) => new WeightedEditDistance({ rules, normalize: (s) => s, costs: { substitute: 1, delete: 0.7, insert: 0.6 } })
      const a = make(full)
      const b = make(plain)
      const words = Array.from({ length: 12 }, () => randomString(random, letters, 1, 4))
      const ia = new FuzzyIndex(a).addAll(words.map((w) => [w, null]))
      const ib = new FuzzyIndex(b).addAll(words.map((w) => [w, null]))
      for (let q = 0; q < 6; q++) {
        const x = randomString(random, letters, 1, 4)
        for (const y of words) {
          expect(a.distance(x, y), `${x} → ${y}`).toBe(b.distance(x, y))
        }
        expect(ia.search(x, { maxDistance: 1.5 })).toEqual(ib.search(x, { maxDistance: 1.5 }))
      }
    }
  })

  // 構詞音變真的會作用（reaching check）：同一對字串在交界上便宜得多
  it('固定案例：詞尾濁化 b → p 只在交界（alebi → alep ＋ -i），詞中的 b 不算', () => {
    const rules = new RuleSet().add('b', 'p', 0.05, { junction: true })
    const m = new WeightedEditDistance({ rules, normalize: (s) => s, costs: { substitute: 1, delete: 1, insert: 1 } })
    expect(m.distance('alebi', 'alepi')).toBe(1)
    const x = Array.from('alebi')
    expect(m.jointDistance(x, [{ chars: Array.from('alep'), lock: false }, { chars: ['i'], lock: true }])).toBeCloseTo(0.05, 9)
  })
})
