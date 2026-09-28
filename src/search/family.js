/**
 * @file 詞條家族：辭典已經確認屬於同一個詞條的記錄（詞根與其衍生詞形、例句），在搜尋結果中排在一起。
 *
 * ## 上層記錄（建索引時計算，docs.json 的 `parent`）
 * 每筆記錄最多有一個上層記錄，形成一片樹林；樹根就是家族的代表（通常是詞根條目）。上層關係只取資料明確寫出的：
 * 1. 詞條群組（group.type 'entry'）內的詞形、例句：`group.parent` 指定的記錄，沒有指定時是群組的詞目（role 'head'）
 *    ——例如 kita- 條下的 pakita，以及 pakita 底下的 pinakita。
 * 2. 記錄的 `related` 有 `derived-from` 連結：連到的記錄。
 * 3. 另立條目的詞目，`morphology.derivedFrom` 有 `<`（衍生自）：同一來源中詞形相同的另一個詞目
 *    ——例如另立條目的 pakita（p.225，「< kita-」）接到 kita- 條。
 *    **對不到唯一一個詞目時不連**（同形異義詞：apu 有兩個條目），寧可分開，不要接錯。
 * 最後切斷循環（兩個條目互相標為衍生自對方），每筆記錄都一定走得到樹根。
 *
 * ## 分組與排序（查詢時，buildEntryGroups）
 * - 命中的記錄依樹根分組；命中記錄到樹根之間的上層記錄即使沒有命中也放進來（只是為了看出上下層關係）。
 * - 家族的名次由家族中**最好的命中**決定：子項目與查詢完全相同時，整個家族跟著排到前面。
 *   同分時依序比較（以詞根身分命中的都不算，那是詞根命中的連帶結果）：
 *   達到最好分數的命中較多的在前；命中較多的在前（查 kinawas：kawas- 條同時有詞根與 kinawas，
 *   排在只有 kinawas 一個例子的 <in> 條之前）；最後依 compareHits 比較最好的命中。
 * - 家族內樹根固定在最上面；同一層的子項目依子樹中最好的分數排，同分依辭典中的順序。
 * - 另立條目的詞目與同一層某個詞形寫法相同時（p.225 的 pakita 與 kita- 條下的 pakita），併成一列（`also`）。
 *
 * ## 同形詞組（查詢時，mergeSpellings）
 * 不同來源（或同一來源的同形異義詞）各自登錄、寫法完全相同的詞，搜尋結果中合成一項：詞形只寫一次，
 * 底下每筆記錄一列（釋義、方言、出處）。「寫法完全相同」比的是原始寫法（Unicode 正規化、去頭尾空白），
 * 附加符號不同就是不同的寫法（maturai 與 mātūra͡i 分開）。
 * - 只合併**單獨一筆**的結果；有上下層的家族（kita- 條）維持原樣，不塞進同形詞組。
 * - 家族中也有同樣寫法的命中時（kita- 條下的 mikita），同形詞組另外列一份，標明它也在哪個詞條下，
 *   讀者在同形詞組裡就能看到這個詞在所有來源的釋義。家族本身不變。
 *   同一來源、釋義也相同的已經在組裡時不再列（辭典在詞條下與另立條目各列一次 apui，不是兩個不同的說法）。
 * - 同形詞組排在其中最前面那一筆原本的位置。
 */

/** 分數比較容許的浮點誤差（分數是幾個小數相加） */
const EPSILON = 1e-9

/** 上層關係的最大深度（防止資料錯誤造成過長的鏈） */
const MAX_DEPTH = 32

/**
 * `derivedFrom` 的文字可能帶註記（「kawas?」、「kuras 'thunder'」、「bair- = bail-」、「pizi-~ pidi-」）：
 * 依序試原文、去掉註記後的各個寫法。
 * @param {string} text
 * @returns {string[]}
 */
export function derivationCandidates(text) {
  const out = [text.trim()]
  const cleaned = text
    .replace(/'[^']*'/g, ' ') // 引號中的釋義
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[?？]/g, ' ')
  for (const part of cleaned.split(/[=~,，;；]/)) {
    const t = part.trim()
    if (t && !/\s/.test(t)) out.push(t)
  }
  return [...new Set(out)]
}

/**
 * 計算每筆記錄的上層記錄（索引；沒有則為 -1）。
 * @param {Array<{record: import('../schema/types.js').CorpusRecord}>} items 與 docs 同順序
 * @param {import('../schema/types.js').CorpusGroup[]} groups
 * @param {(text: string) => string} searchKey
 * @returns {number[]}
 */
export function computeParents(items, groups, searchKey) {
  const groupType = new Map(groups.map((g) => [g.id, g.type]))
  /** @type {Map<string, number>} */
  const indexById = new Map()
  items.forEach(({ record }, k) => indexById.set(record.id, k))
  const isEntry = (/** @type {import('../schema/types.js').CorpusRecord} */ r) => !!r.group && groupType.get(r.group.id) === 'entry'

  /** @type {Map<string, number>} 詞條群組 id → 詞目 */
  const headOf = new Map()
  /** @type {Map<string, number[]>} 來源＋搜尋鍵 → 詞目 */
  const headsByKey = new Map()
  items.forEach(({ record: r }, k) => {
    if (!isEntry(r) || r.group?.role !== 'head') return
    if (!headOf.has(/** @type {any} */ (r.group).id)) headOf.set(/** @type {any} */ (r.group).id, k)
    const key = `${r.source}\u0000${searchKey(r.text)}`
    const list = headsByKey.get(key)
    if (list) list.push(k)
    else headsByKey.set(key, [k])
  })

  /**
   * 另立條目的詞目 → 衍生來源的詞目；對不到唯一一個就是 -1
   * @param {import('../schema/types.js').CorpusRecord} r
   */
  const resolveDerivation = (r) => {
    for (const d of r.morphology?.derivedFrom ?? []) {
      if (d.relation !== '<') continue
      for (const text of derivationCandidates(d.text)) {
        const all = (headsByKey.get(`${r.source}\u0000${searchKey(text)}`) ?? []).filter(
          (h) => items[h].record.group?.id !== r.group?.id,
        )
        if (all.length === 1) return all[0]
        // 寫法完全相同的只有一個時取它（kita- 與 kita 的搜尋鍵相同）；同形異義詞則不連
        const exact = all.filter((h) => items[h].record.text === text)
        if (exact.length === 1) return exact[0]
      }
    }
    return -1
  }

  const parent = items.map(({ record: r }, k) => {
    if (isEntry(r) && r.group?.role !== 'head') {
      const group = /** @type {import('../schema/types.js').GroupRef} */ (r.group)
      const p = (group.parent ? indexById.get(group.parent) : undefined) ?? headOf.get(group.id)
      return p === undefined || p === k ? -1 : p
    }
    const link = r.related.find((l) => l.type === 'derived-from' && indexById.has(l.target))
    if (link) {
      const p = /** @type {number} */ (indexById.get(link.target))
      return p === k ? -1 : p
    }
    return isEntry(r) ? resolveDerivation(r) : -1
  })

  // 切斷循環與過長的鏈：沿上層走，回到走過的記錄（或超過深度）就切斷最後一條連結
  const state = new Uint8Array(parent.length) // 0 未處理、1 處理中、2 已確認走得到樹根
  for (let k = 0; k < parent.length; k++) {
    /** @type {number[]} */
    const path = []
    let x = k
    while (x !== -1 && state[x] === 0) {
      state[x] = 1
      path.push(x)
      const p = parent[x]
      if (p !== -1 && (state[p] === 1 || path.length >= MAX_DEPTH)) {
        parent[x] = -1
        break
      }
      x = p
    }
    for (const y of path) state[y] = 2
  }
  return parent
}

/**
 * @typedef {object} EntryNode 家族樹中的一列
 * @property {import('./format.js').DocSummary} doc
 * @property {import('./engine.js').EntryHit | null} hit 這筆記錄的命中；null 表示只是命中記錄的上層（為了看出上下層關係）
 * @property {Array<{doc: import('./format.js').DocSummary, hit: import('./engine.js').EntryHit | null}>} also
 *   寫法相同、另立條目的詞目，併在這一列
 * @property {EntryNode[]} children
 * @property {number} best 子樹（含本身與 also）中最好的分數；沒有命中為 Infinity
 * @property {number} hits 子樹中命中的記錄數
 */

/**
 * @typedef {object} EntryGroup 搜尋結果中的一項：一個詞條家族，或一個同形詞組（有 spelling）
 * @property {EntryNode} root 樹根（家族的代表）；同形詞組是第一筆單獨的結果
 * @property {import('./engine.js').EntryHit} best 最好的命中
 * @property {number} hits 命中的記錄數
 * @property {SpellingSet} [spelling] 同形詞組（mergeSpellings）
 */

/**
 * @typedef {object} SpellingSet 寫法完全相同的一組記錄
 * @property {string} text 寫法
 * @property {SpellingMember[]} members 依結果順序；也在家族中的排在最後
 */

/**
 * @typedef {object} SpellingMember
 * @property {import('./format.js').DocSummary} doc
 * @property {import('./engine.js').EntryHit} hit
 * @property {import('./format.js').DocSummary | null} family 也列在哪個家族（樹根）底下；單獨的結果是 null
 */

/**
 * 把詞條命中依家族分組並排序。
 * @param {Iterable<import('./engine.js').EntryHit>} hits 每筆記錄最多一個命中
 * @param {{
 *   parent: ArrayLike<number>,
 *   children?: (k: number) => readonly number[],
 *   doc: (k: number) => import('./format.js').DocSummary,
 *   key: (text: string) => string,
 *   compareHits: (a: import('./engine.js').EntryHit, b: import('./engine.js').EntryHit) => number,
 * }} ctx
 * @returns {EntryGroup[]}
 */
export function buildEntryGroups(hits, { parent, children = () => [], doc, key, compareHits }) {
  /** @type {Map<number, EntryNode>} */
  const nodes = new Map()
  /** @type {EntryNode[]} */
  const roots = []
  const nodeOf = (/** @type {number} */ k) => {
    let node = nodes.get(k)
    if (node) return { node, created: false }
    node = { doc: doc(k), hit: null, also: [], children: [], best: Infinity, hits: 0 }
    nodes.set(k, node)
    return { node, created: true }
  }
  for (const hit of hits) {
    const k = hit.doc.index
    const { node, created } = nodeOf(k)
    node.hit = hit
    node.doc = hit.doc
    if (!created) continue
    // 往上接到已經存在的節點或樹根
    let child = node
    let x = parent[k] ?? -1
    let depth = 0
    for (; x !== -1 && depth < MAX_DEPTH; x = parent[x] ?? -1, depth++) {
      const up = nodeOf(x)
      up.node.children.push(child)
      if (!up.created) break
      child = up.node
    }
    if (x === -1 || depth >= MAX_DEPTH) roots.push(child)
  }

  /** @param {EntryNode} node */
  const finish = (node) => {
    // 先併列，被併進來的子項目才會跟著一起計算與排序
    foldAliases(node, { key, children, doc, nodeOf: (k) => nodeOf(k).node })
    for (const c of node.children) finish(c)
    node.children.sort((a, b) => (Math.abs(a.best - b.best) > EPSILON ? a.best - b.best : a.doc.index - b.doc.index))
    const own = [node.hit, ...node.also.map((a) => a.hit)].filter((h) => h !== null)
    node.best = Math.min(...own.map((h) => /** @type {any} */ (h).score), ...node.children.map((c) => c.best))
    node.hits = own.length + node.children.reduce((n, c) => n + c.hits, 0)
  }

  /** @type {Array<EntryGroup & {atBest: number, related: number}>} */
  const groups = roots.map((root) => {
    finish(root)
    const all = collectHits(root)
    const best = all.reduce((a, b) => (compareHits(b, a) < 0 ? b : a))
    // 以詞根身分命中的（辭典標註衍生自查詢詞根的詞）是詞根命中的連帶結果，不算獨立的證據
    const own = all.filter((h) => h.kind !== 'root')
    const atBest = own.filter((h) => Math.abs(h.score - best.score) <= EPSILON).length
    return { root, best, hits: all.length, atBest, related: own.length }
  })
  groups.sort(
    (a, b) =>
      (Math.abs(a.best.score - b.best.score) > EPSILON ? a.best.score - b.best.score : 0) ||
      b.atBest - a.atBest ||
      b.related - a.related ||
      compareHits(a.best, b.best),
  )
  return groups.map(({ root, best, hits: n }) => ({ root, best, hits: n }))
}

/** 比對同形用的寫法：原始寫法，只做 Unicode 正規化與去頭尾空白（附加符號不同就是不同的寫法） @param {string} text */
export const spellingOf = (text) => text.normalize('NFC').trim()

/**
 * 把寫法完全相同的單獨結果合成同形詞組（見檔頭「同形詞組」）。家族不變；家族中同樣寫法的命中另外列一份進同形詞組。
 * @param {EntryGroup[]} groups buildEntryGroups 的結果（已排序）
 * @returns {EntryGroup[]}
 */
export function mergeSpellings(groups) {
  const single = (/** @type {EntryGroup} */ g) => g.root.children.length === 0 && g.root.also.length === 0 && g.root.hit !== null
  /** @type {Map<string, EntryGroup[]>} 寫法 → 單獨的結果 */
  const standalone = new Map()
  for (const g of groups) {
    if (!single(g)) continue
    const key = spellingOf(g.root.doc.text)
    const list = standalone.get(key)
    if (list) list.push(g)
    else standalone.set(key, [g])
  }
  /** @type {Map<string, SpellingMember[]>} 寫法 → 家族中同樣寫法的命中 */
  const inFamily = new Map()
  for (const g of groups) {
    if (single(g)) continue
    /** @param {EntryNode} node */
    const visit = (node) => {
      const member = representative(node, g.root.doc)
      if (member && standalone.has(spellingOf(member.doc.text))) {
        const key = spellingOf(member.doc.text)
        const list = inFamily.get(key)
        if (list) list.push(member)
        else inFamily.set(key, [member])
      }
      node.children.forEach(visit)
    }
    visit(g.root)
  }

  /** @type {EntryGroup[]} */
  const out = []
  /** @type {Set<string>} */
  const emitted = new Set()
  for (const g of groups) {
    if (!single(g)) {
      out.push(g)
      continue
    }
    const key = spellingOf(g.root.doc.text)
    const alone = /** @type {EntryGroup[]} */ (standalone.get(key))
    // 家族中的那一筆若與某筆單獨的結果同一來源、釋義也相同（辭典在詞條下與另立條目各列一次），不再重複
    const same = new Set(alone.map((a) => sameEntryKey(a.root.doc)))
    const extra = (inFamily.get(key) ?? []).filter((m) => !same.has(sameEntryKey(m.doc)))
    if (alone.length + extra.length < 2) {
      out.push(g)
      continue
    }
    if (emitted.has(key)) continue
    emitted.add(key)
    /** @type {SpellingMember[]} */
    const members = [
      ...alone.map((a) => ({ doc: a.root.doc, hit: /** @type {import('./engine.js').EntryHit} */ (a.root.hit), family: null })),
      ...extra,
    ]
    out.push({ root: g.root, best: g.best, hits: members.length, spelling: { text: key, members } })
  }
  return out
}

/** 同一來源、同樣釋義 @param {import('./format.js').DocSummary} doc */
const sameEntryKey = (doc) => `${doc.source} ${doc.zh} ${doc.en}`

/**
 * 家族中一列作為同形詞組成員的代表：有命中的另立條目（完整的詞條，有自己的出處）優先，其次是這一列本身。
 * @param {EntryNode} node
 * @param {import('./format.js').DocSummary} family 家族的樹根
 * @returns {SpellingMember | null}
 */
function representative(node, family) {
  const head = node.also.find((a) => a.hit !== null && a.doc.role === 'head')
  if (head) return { doc: head.doc, hit: /** @type {import('./engine.js').EntryHit} */ (head.hit), family }
  if (node.hit) return { doc: node.doc, hit: node.hit, family }
  const any = node.also.find((a) => a.hit !== null)
  return any ? { doc: any.doc, hit: /** @type {import('./engine.js').EntryHit} */ (any.hit), family } : null
}

/**
 * 另立條目的詞目（role 'head'）與同一層某個詞形（role 'form'）寫法相同時，併進那個詞形的一列。
 * 詞形本身沒有命中也照併（p.206 另立的 murazem 併進 razem 條下的 murazem）：同一個詞在家族中只出現一次，
 * 位置就是辭典列出它的地方。所以要看這一層在資料中的所有詞形，不只是有命中的。
 * @param {EntryNode} node
 * @param {{
 *   key: (text: string) => string,
 *   children: (k: number) => readonly number[],
 *   doc: (k: number) => import('./format.js').DocSummary,
 *   nodeOf: (k: number) => EntryNode,
 * }} ctx children 是資料中的下層記錄；nodeOf 取得（或建立）記錄的節點
 */
function foldAliases(node, { key, children, doc, nodeOf }) {
  const heads = node.children.filter((c) => c.doc.role === 'head')
  if (heads.length === 0) return
  /** @type {Map<string, number>} 搜尋鍵 → 這一層第一個寫法相同的詞形 */
  const forms = new Map()
  for (const k of children(node.doc.index)) {
    const d = doc(k)
    if (d.role === 'form' && !forms.has(key(d.text))) forms.set(key(d.text), k)
  }
  for (const c of node.children) if (c.doc.role === 'form' && !forms.has(key(c.doc.text))) forms.set(key(c.doc.text), c.doc.index)
  for (const c of heads) {
    const k = forms.get(key(c.doc.text))
    if (k === undefined) continue
    const target = nodeOf(k)
    if (!node.children.includes(target)) node.children.push(target)
    target.also.push({ doc: c.doc, hit: c.hit }, ...c.also)
    target.children.push(...c.children)
    node.children.splice(node.children.indexOf(c), 1)
  }
}

/**
 * 子樹中所有的命中（依樹的順序：先本身、再 also、再子項目）。
 * @param {EntryNode} node
 * @returns {import('./engine.js').EntryHit[]}
 */
export function collectHits(node) {
  const own = [node.hit, ...node.also.map((a) => a.hit)].filter((h) => h !== null)
  return [.../** @type {import('./engine.js').EntryHit[]} */ (own), ...node.children.flatMap(collectHits)]
}
