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

import { msg } from '../site/messages.js'

/** 動態規劃表：每一格的值由哪一種操作得到 */
export const CELL_NOTES = {
  match: msg('D({i}, {j}) ＝ {value}：兩邊的字元相同，沿用 D({fromI}, {fromJ}) ＝ {from}。'),
  substitute: msg('D({i}, {j}) ＝ {value}：替換，D({fromI}, {fromJ}) ＋ {stepCost}。'),
  delete: msg('D({i}, {j}) ＝ {value}：刪除查詢多出的字元，D({fromI}, {fromJ}) ＋ {stepCost}。'),
  insert: msg('D({i}, {j}) ＝ {value}：補上查詢少的字元，D({fromI}, {fromJ}) ＋ {stepCost}。'),
  rule: msg('D({i}, {j}) ＝ {value}：方言規則 {rule}，D({fromI}, {fromJ}) ＋ {stepCost}。'),
}

/** 構詞搜尋：每一個通道的說明 */
export const CHANNEL_NOTES = {
  plain: msg('通道「{text}」：沒有前綴，詞幹從詞首開始，至少要接一個後綴。'),
  prefix: msg('通道「{text}」：詞幹從合併後的前綴狀態開始，之後可以接後綴，也可以就是詞尾。'),
  circumfix: msg('通道「{text}」：詞幹接在環綴 {form} 的左邊之後，詞尾一定接它的後綴；兩側合起來算一個步驟。'),
  infix: msg('拿掉中綴 <{form}>，得到還原變體「{text}」：詞幹的起點固定在查詢上。'),
  reduplication: msg('拿掉重疊部分「{form}」，得到還原變體「{text}」：詞幹的起點與長度由重疊模板決定。'),
  circumfixInner: msg('拿掉環綴 {form} 的左邊「{left}」，得到還原變體「{text}」：詞幹的起點固定在查詢上，詞尾一定接它的後綴。'),
}

/** 構詞搜尋：找不到指定詞根的原因 */
export const MISS_NOTES = {
  same: msg('「{term}」就是查詢本身，屬於普通的模糊命中。'),
  short: msg('「{term}」比詞根的最短長度還短。'),
  bound: msg('「{term}」最好的分析也超過總成本上限 {maxDistance}。'),
  spread: msg('「{term}」的成本超過截斷線 {cutoff}（最佳命中 ＋ lemmaSpread），所以沒有列出。'),
}

/** 整個詞的對齊：每一步的說明 */
export const ALIGN_NOTES = {
  substitute: msg('「{source}」換成「{target}」，成本 {cost}。'),
  delete: msg('刪掉查詢中的「{source}」，成本 {cost}。'),
  insert: msg('補上「{target}」，成本 {cost}。'),
  rule: msg('規則「{source}」→「{target}」，成本 {cost}。'),
}

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
        key: CELL_NOTES[/** @type {keyof typeof CELL_NOTES} */ (best.op)],
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
    note: { key: msg('表格填完，右下角就是距離 {distance}。沿著每格的最佳來源回溯，得到最佳對齊（{length} 步）。'), params: { distance: e.distance, length: e.alignment.length } },
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
      key: ev.pruned ? msg('剪枝「{prefix}」：下界 {lowerBound} ＞ 上限 {bound}，整個子樹略過。') : ev.accepted ? msg('「{prefix}」是詞，距離 {distance} 在上限 {bound} 以內，收進結果。') : ev.terminal ? msg('「{prefix}」是詞，但距離 {distance} 超過上限 {bound}；子樹中可能還有更近的詞，繼續往下。') : msg('走訪「{prefix}」：這一列的下界 {lowerBound} 不超過上限 {bound}，繼續往下。'),
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
    steps.push({ kind: 'result', phase: 'result', focus: null, note: { key: msg('查詢太短：至少要比詞根最短長度（{minStem}）多一個字元，才做構詞搜尋。'), params: { minStem: e.params.minStem } } })
    return steps
  }
  e.prefixLevels.forEach((/** @type {Array<number | null>} */ row, /** @type {number} */ s) => {
    steps.push({ kind: 'level', phase: 'levels', focus: { side: 'prefix', level: s + 1 }, note: { key: msg('前綴第 {level} 層：所有「恰好 {level} 個前綴」的鏈，在最內側交界的狀態逐項取 min 合併，{count} 格有值。每一層只走一次前綴 trie。'), params: { level: s + 1, count: finiteCount(row) } }, proofRef: BCDP_DOC.levels })
  })
  e.suffixLevels.forEach((/** @type {Array<number | null>} */ row, /** @type {number} */ s) => {
    steps.push({ kind: 'level', phase: 'levels', focus: { side: 'suffix', level: s + 1 }, note: { key: msg('後綴第 {level} 層：由詞尾往內，用鏡像的規則走後綴 trie，「恰好 {level} 個後綴」的鏈合併成一列，{count} 格有值。'), params: { level: s + 1, count: finiteCount(row) } }, proofRef: BCDP_DOC.levels })
  })
  steps.push({
    kind: 'merge',
    phase: 'levels',
    focus: null,
    note: {
      key: msg('各層前綴合併成詞幹的起點（{prefix} 格有值），各層後綴合併成詞尾的耦合（{suffix} 格有值）；另有 {crossing} 個還沒走完、會跨越交界的規則。'),
      params: { prefix: finiteCount(e.merged.P), suffix: finiteCount(e.merged.S), crossing: e.merged.crossingP.length + e.merged.crossingS.length },
    },
    proofRef: BCDP_DOC.junction,
  })
  e.variants.forEach((/** @type {any} */ v, /** @type {number} */ c) => {
    // 中綴、重疊式的環綴：變體拿掉的是環綴的左邊，詞尾一定接它的後綴
    const circumfix = v.op?.type === 'circumfix'
    const key = circumfix && v.kind !== 'circumfix' ? 'circumfixInner' : v.kind
    // 前綴式環綴的通道由後綴相同的幾個環綴共用：列出它們（還原變體說明第一個步驟，其他的在實驗室的通道清單中列出）
    const form = v.kind === 'circumfix' && v.options?.length ? v.options.map(circumfixLabel).join('、') : circumfix ? circumfixLabel(v.op) : (v.op?.form ?? '')
    steps.push({
      kind: 'variant',
      phase: 'channels',
      focus: { channel: c },
      note: { key: CHANNEL_NOTES[/** @type {keyof typeof CHANNEL_NOTES} */ (key)], params: { text: v.text, form, left: v.op?.left?.form ?? '' } },
      proofRef: v.op ? BCDP_DOC.variants : BCDP_DOC.walk,
    })
  })
  e.walks.forEach((/** @type {NodeEvent[]} */ walk, /** @type {number} */ c) => {
    steps.push({
      kind: 'walk',
      phase: 'channels',
      focus: { channel: c },
      note: {
        key: msg('通道「{text}」：與普通搜尋共用一次詞圖走訪，走訪 {visited} 個節點、剪掉 {pruned} 個；走到詞尾時與後綴耦合，{found} 個詞在上限內。'),
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
        ? { key: msg('找到 {count} 個詞根，只保留成本在 {cutoff} 以內的。'), params: { count: e.hits.length, cutoff: e.cutoff } }
        : e.hit
          ? { key: msg('「{term}」的最佳分析，成本 {distance}（{steps} 個構詞步驟）。下面逐步列出整個詞的對齊。'), params: { term: e.term, distance: e.hit.distance, steps: e.hit.steps.length } }
          : { key: MISS_NOTES[/** @type {keyof typeof MISS_NOTES} */ (e.reason)], params: { term: e.term, maxDistance: e.params.maxDistance, cutoff: e.cutoff } },
    proofRef: BCDP_DOC.result,
  })
  if (e.alignment) {
    e.alignment.steps.forEach((/** @type {any} */ st, /** @type {number} */ k) => {
      if (st.op === 'match') return
      steps.push({
        kind: 'align',
        phase: 'alignment',
        focus: { step: k },
        note: { key: ALIGN_NOTES[/** @type {keyof typeof ALIGN_NOTES} */ (st.op)], params: { source: st.source, target: st.target, cost: st.cost } },
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

/**
 * 環綴（包覆單位）的寫法：前綴式 `ta-…-aw`、中綴式 `<in>…-an`、重疊式 `da~…-ay`；
 * 外側緊貼前綴的 `m-<a>…-ay`、沒有後綴的 `m-<a>`。
 * @param {{left: {type: string, form: string}, outer?: string, suffix?: string}} step
 */
export function circumfixLabel(step) {
  const { type, form } = step.left
  const left = type === 'prefix' ? `${form}-` : type === 'infix' ? `<${form}>` : `${form}~`
  return `${step.outer ? `${step.outer}-` : ''}${left}${step.suffix ? `…-${step.suffix}` : ''}`
}
