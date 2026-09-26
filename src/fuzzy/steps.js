/**
 * @file 演算法實驗室的步驟模型（與 Vue 無關）。
 *
 * 把正式實作的說明結果（`metric.explain`、詞圖走訪的 onNode 事件、`morphSearch.explain`）切成一步一步，
 * 給播放控制使用（docs/lab-design.md 第 6 節）。步驟只是「看的順序」，所有數值都來自正式實作；
 * 畫面狀態完全由步驟序號推出（`*StateAt`），所以跳到任何一步都是純函式，網址的 step 參數可以重現畫面。
 *
 * 每一步：
 * - kind：這一步的種類（決定畫面怎麼標示）
 * - phase：所屬的階段（BCDP 的各個面板；DP、詞圖只有一個階段）
 * - focus：目前焦點（哪一格、哪個節點）
 * - note：說明文字的語系鍵與參數（`t(note.key, note.params)`）
 * - proofRef：對應的文件段落（選填），例如 `bcdp.md#4-交界狀態`
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
  new Set(['value', 'from', 'stepCost', 'distance', 'cost', 'lowerBound', 'bound', 'start', 'end', 'total', 'maxDistance', 'cutoff']),
)

/** bcdp.md 各節的錨點（GitHub 的標題錨點規則） */
const BCDP_DOC = {
  junction: 'bcdp.md#4-交界狀態',
  levels: 'bcdp.md#5-詞綴一層一層合併',
  variants: 'bcdp.md#6-非串接步驟還原變體',
  walk: 'bcdp.md#7-詞幹一次走訪與耦合',
  alignment: 'bcdp.md#8-說明找回詞綴鏈與整個詞的對齊',
  result: 'bcdp.md#9-正確性與複雜度',
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

/** 一列中有值（不是 null）的格數 @param {Array<number | null>} row */
const finiteCount = (row) => row.filter((v) => v !== null).length

/**
 * BCDP 的步驟（morphSearch.explain 的結果）：
 * 1. 前綴、後綴各層：每一層一步（這一層合併了幾格）
 * 2. 合併：各層前綴合併成詞幹的起點、各層後綴合併成詞尾的耦合，另有幾個跨界狀態
 * 3. 通道：每個通道一步（原查詢或還原變體）
 * 4. 詞圖走訪：每個通道一步（走訪了幾個節點、找到幾個詞）
 * 5. 結果：一步
 * 6. 指定詞根而且命中時：整個詞的對齊中，每個不是「相同」的轉移一步
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
  e.prefixLevels.forEach((/** @type {Array<number | null>} */ row, /** @type {number} */ s) => {
    steps.push({ kind: 'level', phase: 'levels', focus: { side: 'prefix', level: s + 1 }, note: { key: 'lab.note.bcdp.levelPrefix', params: { level: s + 1, count: finiteCount(row) } }, proofRef: BCDP_DOC.levels })
  })
  e.suffixLevels.forEach((/** @type {Array<number | null>} */ row, /** @type {number} */ s) => {
    steps.push({ kind: 'level', phase: 'levels', focus: { side: 'suffix', level: s + 1 }, note: { key: 'lab.note.bcdp.levelSuffix', params: { level: s + 1, count: finiteCount(row) } }, proofRef: BCDP_DOC.levels })
  })
  steps.push({
    kind: 'merge',
    phase: 'levels',
    focus: null,
    note: {
      key: 'lab.note.bcdp.merge',
      params: { prefix: finiteCount(e.merged.P), suffix: finiteCount(e.merged.S), crossing: e.merged.crossingP.length + e.merged.crossingS.length },
    },
    proofRef: BCDP_DOC.junction,
  })
  e.variants.forEach((/** @type {any} */ v, /** @type {number} */ c) => {
    steps.push({
      kind: 'variant',
      phase: 'channels',
      focus: { channel: c },
      note: { key: `lab.note.bcdp.channel.${v.kind}`, params: { text: v.text, form: v.op?.form ?? '' } },
      proofRef: v.op ? BCDP_DOC.variants : BCDP_DOC.walk,
    })
  })
  e.walks.forEach((/** @type {NodeEvent[]} */ walk, /** @type {number} */ c) => {
    steps.push({
      kind: 'walk',
      phase: 'channels',
      focus: { channel: c },
      note: {
        key: 'lab.note.bcdp.walk',
        params: { text: e.variants[c].text, visited: walk.length, pruned: walk.filter((ev) => ev.pruned).length, found: e.candidates[c].length },
      },
      proofRef: BCDP_DOC.walk,
    })
  })
  steps.push({
    kind: 'result',
    phase: 'result',
    focus: null,
    note:
      e.term === null
        ? { key: 'lab.note.bcdp.hits', params: { count: e.hits.length, cutoff: e.cutoff } }
        : e.hit
          ? { key: 'lab.note.bcdp.hit', params: { term: e.term, distance: e.hit.distance, steps: e.hit.steps.length } }
          : { key: `lab.note.bcdp.miss.${e.reason}`, params: { term: e.term, maxDistance: e.params.maxDistance, cutoff: e.cutoff } },
    proofRef: BCDP_DOC.result,
  })
  if (e.alignment) {
    e.alignment.steps.forEach((/** @type {any} */ st, /** @type {number} */ k) => {
      if (st.op === 'match') return
      steps.push({
        kind: 'align',
        phase: 'alignment',
        focus: { step: k },
        note: { key: `lab.note.bcdp.align.${st.op}`, params: { source: st.source, target: st.target, cost: st.cost } },
        proofRef: BCDP_DOC.alignment,
      })
    })
  }
  return steps
}

/**
 * 第 index 步時的 BCDP 畫面狀態：
 * - prefixLevels、suffixLevels：已經顯示到第幾層；merged：合併後的起點與耦合是否已顯示
 * - channels、walks：已經顯示到第幾個通道、第幾次走訪
 * - result：結果是否已顯示；aligned：整個詞的對齊已經顯示到第幾步（對齊步驟的序號 ＋ 1）
 * @param {any} e
 * @param {Step[]} steps
 * @param {number} index
 */
export function bcdpStateAt(e, steps, index) {
  const k = clamp(index, -1, steps.length - 1)
  let prefixLevels = 0
  let suffixLevels = 0
  let merged = false
  let channels = 0
  let walks = 0
  let result = false
  let aligned = 0
  for (let s = 0; s <= k; s++) {
    const step = steps[s]
    const f = /** @type {any} */ (step.focus)
    if (step.kind === 'level') {
      if (f.side === 'prefix') prefixLevels = f.level
      else suffixLevels = f.level
    } else if (step.kind === 'merge') merged = true
    else if (step.kind === 'variant') channels = f.channel + 1
    else if (step.kind === 'walk') walks = f.channel + 1
    else if (step.kind === 'result') result = true
    else if (step.kind === 'align') aligned = f.step + 1
  }
  // 最後一步：對齊全部顯示（包含最後一個不是「相同」的步驟之後的相同字元）
  if (k === steps.length - 1 && e.alignment) aligned = e.alignment.steps.length
  return { phase: k >= 0 ? steps[k].phase : 'levels', focus: k >= 0 ? steps[k].focus : null, prefixLevels, suffixLevels, merged, channels, walks, result, aligned }
}

/** @param {number} x @param {number} lo @param {number} hi */
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.floor(x)))
}
