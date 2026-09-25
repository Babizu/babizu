/**
 * @file 演算法實驗室的步驟模型（與 Vue 無關）。
 *
 * 把正式實作的說明結果（`metric.explain`、詞圖走訪的 onNode 事件、`morphSearch.explain`）切成一步一步，
 * 給播放控制使用（docs/lab-design.md 第 6 節）。步驟只是「看的順序」，所有數值都來自正式實作；
 * 畫面狀態完全由步驟序號推出（`*StateAt`），所以跳到任何一步都是純函式，網址的 step 參數可以重現畫面。
 *
 * 每一步：
 * - kind：這一步的種類（決定畫面怎麼標示）
 * - phase：所屬的階段（BCDP 的四個面板；DP、詞圖只有一個階段）
 * - focus：目前焦點（哪一格、哪個節點）
 * - note：說明文字的語系鍵與參數（`t(note.key, note.params)`）
 * - proofRef：對應的文件段落（選填），例如 `bcdp.md#5-詞綴圖表是最短路徑`
 */

/**
 * @typedef {object} Step
 * @property {string} kind
 * @property {string} phase
 * @property {Record<string, unknown> | null} focus
 * @property {{key: string, params: Record<string, unknown>}} note
 * @property {string} [proofRef]
 */

/**
 * 說明參數中哪些是距離或成本（顯示前以 formatDistance 格式化；null 表示 ∞）；其餘是索引、個數或文字。
 */
export const DISTANCE_PARAMS = Object.freeze(
  new Set(['value', 'from', 'stepCost', 'distance', 'cost', 'lowerBound', 'bound', 'start', 'end', 'total', 'lambda', 'maxDistance', 'cutoff']),
)

/** bcdp.md 各節的錨點（GitHub 的標題錨點規則） */
const BCDP_DOC = {
  charts: 'bcdp.md#5-詞綴圖表是最短路徑',
  variants: 'bcdp.md#7-非串接步驟還原變體',
  walk: 'bcdp.md#8-多通道一次走訪',
  pricing: 'bcdp.md#9-兩階段候選與計價',
  result: 'bcdp.md#10-正確性與複雜度',
}

// ── 動態規劃表 ─────────────────────────────────────────────────────────

/**
 * 動態規劃表的步驟：依計算順序每格一步（起點格除外，它沒有候選轉移），最後一步標出最佳路徑。
 * @param {import('./distance.js').Explanation} e
 * @returns {Step[]}
 */
export function dpSteps(e) {
  /** @type {Step[]} */
  const steps = []
  for (const [i, j] of e.order) {
    const best = e.candidates[i][j][0]
    if (!best) continue // D(0, 0) ＝ 0（或邊界條件的起點）
    steps.push({
      kind: 'cell',
      phase: 'fill',
      focus: { i, j },
      note: {
        key: `lab.note.cell.${best.op}`,
        params: {
          i,
          j,
          value: e.matrix[i][j],
          fromI: best.from[0],
          fromJ: best.from[1],
          from: e.matrix[best.from[0]][best.from[1]],
          stepCost: best.stepCost,
          alternatives: e.candidates[i][j].length - 1,
          rule: best.rule ? `${best.rule.source || '∅'}→${best.rule.target || '∅'}` : null,
        },
      },
    })
  }
  steps.push({
    kind: 'path',
    phase: 'path',
    focus: null,
    note: { key: 'lab.note.path', params: { distance: e.distance, length: e.alignment.length } },
  })
  return steps
}

/**
 * 第 index 步（0 起算）時已經算好的格數；index ≥ 最後一步時整張表都算好，並顯示最佳路徑。
 * @param {import('./distance.js').Explanation} e
 * @param {Step[]} steps
 * @param {number} index
 */
export function dpStateAt(e, steps, index) {
  const last = steps.length - 1
  const k = clamp(index, -1, last)
  const done = k >= last
  // 每一步是 order 中的一格；order 的第一格（起點）沒有步驟，但在第 0 步之前就已經有值
  const skipped = e.order.length - (steps.length - 1)
  return { revealed: done ? e.order.length : skipped + k + 1, showPath: done, focus: k >= 0 ? steps[k].focus : null }
}

// ── 詞圖搜尋 ───────────────────────────────────────────────────────────

/**
 * @typedef {object} NodeEvent FuzzyIndex 的 onNode 事件
 * @property {string} prefix
 * @property {number} depth
 * @property {number} node
 * @property {number | null} lowerBound
 * @property {number} bound
 * @property {boolean} pruned
 * @property {boolean} terminal
 * @property {number | null} distance
 * @property {boolean} accepted
 */

/**
 * 詞圖搜尋的步驟：每個走訪的節點一步，依走訪順序（深度優先）。
 * @param {NodeEvent[]} events
 * @returns {Step[]}
 */
export function dawgSteps(events) {
  return events.map((ev, n) => ({
    kind: ev.pruned ? 'pruned' : ev.accepted ? 'accepted' : 'node',
    phase: 'walk',
    focus: { index: n, depth: ev.depth, prefix: ev.prefix },
    note: {
      key: ev.pruned ? 'lab.note.node.pruned' : ev.accepted ? 'lab.note.node.accepted' : ev.terminal ? 'lab.note.node.rejected' : 'lab.note.node.open',
      params: { prefix: ev.prefix, lowerBound: ev.lowerBound, bound: ev.bound, distance: ev.distance },
    },
  }))
}

/**
 * 第 index 步時已走訪的節點數與焦點。
 * @param {Step[]} steps
 * @param {number} index
 */
export function dawgStateAt(steps, index) {
  const k = clamp(index, -1, steps.length - 1)
  return { visited: k + 1, focus: k >= 0 ? steps[k].focus : null }
}

// ── BCDP ───────────────────────────────────────────────────────────────

/**
 * BCDP 的步驟（morphSearch.explain 的結果）：
 * 1. 詞綴圖表：每一次**有更新**的鬆弛一步；有位置因為空白而遮掉時，另加一步說明
 * 2. 還原變體：每個變體一步
 * 3. 詞圖走訪：每個通道一步（走訪了幾個節點、剪掉幾個、找到幾個候選）
 * 4. 計價：指定詞根時，每個變體上的每一格一步
 * 5. 結果：一步
 * @param {any} e morphSearch.explain(...) 的結果
 * @returns {Step[]}
 */
export function bcdpSteps(e) {
  /** @type {Step[]} */
  const steps = []
  if (e.tooShort) {
    steps.push({ kind: 'result', phase: 'result', focus: null, note: { key: 'lab.note.bcdp.tooShort', params: { minStem: e.params.minStem } } })
    return steps
  }
  for (const r of e.charts.relaxations) {
    if (!r.improved) continue
    const at = r.table === 'P' ? r.to : r.from
    steps.push({
      kind: 'relax',
      phase: 'charts',
      focus: { table: r.table, slot: r.slot, at, from: r.from, to: r.to },
      note: {
        key: `lab.note.bcdp.relax${r.table}`,
        params: { at, form: r.form, surface: e.chars.slice(r.from, r.to).join(''), distance: r.distance, cost: r.cost, slot: r.slot },
      },
      proofRef: BCDP_DOC.charts,
    })
  }
  const masked = maskedPositions(e)
  if (masked.length) {
    steps.push({ kind: 'mask', phase: 'charts', focus: { positions: masked }, note: { key: 'lab.note.bcdp.mask', params: { count: masked.length } }, proofRef: BCDP_DOC.charts })
  }
  e.variants.forEach((/** @type {any} */ v, /** @type {number} */ vi) => {
    steps.push({
      kind: 'variant',
      phase: 'variants',
      focus: { variant: vi },
      note: {
        key: v.op ? `lab.note.bcdp.variant.${v.op.type}` : 'lab.note.bcdp.variant.original',
        params: { text: v.text, form: v.op?.form ?? null, starts: v.starts.length, ends: v.ends.length },
      },
      proofRef: BCDP_DOC.variants,
    })
  })
  e.walks.forEach((/** @type {NodeEvent[]} */ walk, /** @type {number} */ vi) => {
    steps.push({
      kind: 'walk',
      phase: 'walk',
      focus: { variant: vi },
      note: {
        key: 'lab.note.bcdp.walk',
        params: {
          text: e.variants[vi].text,
          visited: walk.length,
          pruned: walk.filter((ev) => ev.pruned).length,
          candidates: e.candidates[vi].length,
          lambda: e.params.lemmaDistance,
        },
      },
      proofRef: BCDP_DOC.walk,
    })
  })
  for (const p of e.pricing ?? []) {
    for (const cell of p.cells) {
      steps.push({
        kind: cell.skip ? 'skip' : 'price',
        phase: 'pricing',
        focus: { variant: p.variant, i: cell.i, k: cell.k },
        note: {
          key: cell.skip ? `lab.note.bcdp.skip.${cell.skip}` : 'lab.note.bcdp.price',
          params: {
            stem: e.variants[p.variant].chars.slice(cell.i, cell.k).join(''),
            term: e.term,
            distance: cell.distance ?? null,
            start: cell.start ?? null,
            end: cell.end ?? null,
            total: cell.total ?? null,
            lambda: e.params.lemmaDistance,
          },
        },
        proofRef: BCDP_DOC.pricing,
      })
    }
  }
  steps.push({
    kind: 'result',
    phase: 'result',
    focus: null,
    note: e.term === null
      ? { key: 'lab.note.bcdp.hits', params: { count: e.hits.length, cutoff: e.cutoff } }
      : e.hit
        ? { key: 'lab.note.bcdp.hit', params: { term: e.term, distance: e.hit.distance, steps: e.hit.steps.length } }
        : { key: `lab.note.bcdp.miss.${e.reason}`, params: { term: e.term, lambda: e.params.lemmaDistance, maxDistance: e.params.maxDistance, cutoff: e.cutoff } },
    proofRef: BCDP_DOC.result,
  })
  return steps
}

/**
 * 圖表遮掉的位置（詞素交界不能在空白旁）：鬆弛後有值、最後卻是 ∞ 的位置。
 * @param {any} e
 * @returns {Array<{table: 'P' | 'S', at: number}>}
 */
function maskedPositions(e) {
  /** @type {Array<{table: 'P' | 'S', at: number}>} */
  const out = []
  for (const table of /** @type {const} */ (['P', 'S'])) {
    const slots = table === 'P' ? e.charts.Pslots : e.charts.Sslots
    const final = table === 'P' ? e.charts.P : e.charts.S
    for (let at = 0; at < final.length; at++) {
      const any = slots.some((/** @type {Array<number | null>} */ row) => row[at] !== null)
      if (any && final[at] === null) out.push({ table, at })
    }
  }
  return out
}

/**
 * 第 index 步時的 BCDP 畫面狀態：
 * - P、S：目前為止的圖表（每個位置取各槽位的最小值；遮掉的位置在遮罩那一步之後才變成 null）
 * - phase：目前的階段；variants、walks：已經顯示到第幾個變體、第幾個通道
 * - priced：已經計價的格（依變體分組）；result：是否已到最後一步
 * @param {any} e
 * @param {Step[]} steps
 * @param {number} index
 */
export function bcdpStateAt(e, steps, index) {
  const k = clamp(index, -1, steps.length - 1)
  const n = e.chars.length
  /** @type {Array<number | null>} */
  const P = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? 0 : null))
  /** @type {Array<number | null>} */
  const S = Array.from({ length: n + 1 }, (_, i) => (i === n ? 0 : null))
  let variants = 0
  let walks = 0
  /** @type {Array<Array<{i: number, k: number}>>} */
  const priced = (e.variants ?? []).map(() => [])
  for (let s = 0; s <= k; s++) {
    const step = steps[s]
    const f = /** @type {any} */ (step.focus)
    if (step.kind === 'relax') {
      const table = f.table === 'P' ? P : S
      const cost = /** @type {number} */ (step.note.params.cost)
      if (table[f.at] === null || cost < /** @type {number} */ (table[f.at])) table[f.at] = cost
    } else if (step.kind === 'mask') {
      for (const m of f.positions) (m.table === 'P' ? P : S)[m.at] = null
    } else if (step.kind === 'variant') variants = f.variant + 1
    else if (step.kind === 'walk') walks = f.variant + 1
    else if (step.kind === 'price' || step.kind === 'skip') priced[f.variant].push({ i: f.i, k: f.k })
  }
  return {
    phase: k >= 0 ? steps[k].phase : 'charts',
    focus: k >= 0 ? steps[k].focus : null,
    P,
    S,
    variants,
    walks,
    priced,
    result: k >= steps.length - 1,
  }
}

/** @param {number} x @param {number} lo @param {number} hi */
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.floor(x)))
}
