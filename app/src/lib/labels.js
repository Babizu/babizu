/**
 * @file 介面上的代碼顯示名稱與格式化工具。
 *
 * 代碼（單位、角色、校對狀態…）的名稱依介面語系而定，所以都寫成函式、每次呼叫時查字串，
 * 在模板中使用時切換語系會即時更新。語言變體與書寫系統的名稱來自站台設定。
 */

import site from 'virtual:babizu/site'
import { QUALITY_STATUSES } from '@babizu/schema/constants.js'
import { circumfixLabel } from '@babizu/fuzzy/steps.js'
import { locale, msg, t, tr } from '@/i18n.js'

export { QUALITY_STATUSES }
export { formatCount } from '@/i18n.js'

/** 站台設定（瀏覽器端的部分） */
export { site }

/**
 * 代碼 → 名稱。表中寫的是中文原文（也是譯文檔的鍵），顯示時再經過 t()；
 * 表裡沒有的代碼原樣顯示。
 * @param {Record<string, string>} table
 * @param {string} code
 */
const labelOf = (table, code) => (code in table ? t(table[code]) : code)

/** 單位名稱 */
export const UNIT_LABELS = {
  word: msg('詞'),
  phrase: msg('片語'),
  sentence: msg('句子'),
  affix: msg('詞綴／詞根'),
}
/** @param {string} code */
export const unitLabel = (code) => labelOf(UNIT_LABELS, code)

/** 群組角色名稱 */
export const ROLE_LABELS = {
  head: msg('詞條', '角色'),
  example: msg('例句', '角色'),
  form: msg('派生詞'),
  item: msg('條目'),
  segment: msg('語料句'),
}
/** @param {string} code */
export const roleLabel = (code) => labelOf(ROLE_LABELS, code)

/** 來源類型名稱 */
export const SOURCE_TYPE_LABELS = { dictionary: msg('辭典'), wordlist: msg('詞表'), corpus: msg('語料') }
/** @param {string} code */
export const sourceTypeLabel = (code) => labelOf(SOURCE_TYPE_LABELS, code)

/** 校對狀態名稱 */
export const STATUS_LABELS = { unreviewed: msg('未校對'), reviewed: msg('初步校對'), verified: msg('二審校對') }
/** @param {string} code */
export const statusLabel = (code) => labelOf(STATUS_LABELS, code)

/**
 * 詞在記錄中出現的身分（見 babizu/search 的 EntryHit.kind）。這些都是**資料來源寫明的**關係：
 * 確定派生、確定拆解、確定同根來自辭典的條目結構（詞條家族、`<` 標註）；
 * 演算法推定的關係是命中方式（MATCH_TYPES 的自動拆解、自動派生、自動同根），名稱都帶「自動」，兩者不混用。
 */
export const MATCH_KIND_LABELS = {
  head: msg('詞形'),
  alt: msg('其他寫法'),
  variant: msg('變體'),
  root: msg('確定派生'),
  parent: msg('確定拆解'),
  sibling: msg('確定同根'),
  token: msg('句中'),
}
/** @param {string} kind */
export const matchKindLabel = (kind) => labelOf(MATCH_KIND_LABELS, kind)
/** 身分標籤的說明（滑鼠停留時顯示） */
export const MATCH_KIND_HINTS = {
  root: msg('辭典標明這個詞由後面的詞衍生，或把這個詞列在它的條目下；不是演算法推定的'),
  parent: msg('辭典標明後面的詞由這個詞衍生，或把後面的詞列在這個詞的條目下；不是演算法推定的'),
  sibling: msg('這個詞與你輸入的詞在辭典中列在同一個詞（後面的詞）底下；不是演算法推定的'),
}
/** @param {string} kind */
export const matchKindHint = (kind) => (kind in MATCH_KIND_HINTS ? t(MATCH_KIND_HINTS[/** @type {keyof typeof MATCH_KIND_HINTS} */ (kind)]) : '')

/** 編輯操作的名稱 */
export const OP_LABELS = {
  match: msg('相同'),
  substitute: msg('替換'),
  delete: msg('刪除'),
  insert: msg('插入'),
  rule: msg('語音規則'),
}
/** @param {string} op */
export const opLabel = (op) => labelOf(OP_LABELS, op)

/**
 * 命中方式的名稱與說明（見 babizu/search 的 MatchType；fuzzy 沒有標籤）。
 * 演算法推定的構詞關係一律冠上「自動」，與資料來源寫明的關係（MATCH_KIND_LABELS 的「確定…」）區分。
 */
export const MATCH_TYPES = {
  prefix: { label: msg('開頭相符'), hint: msg('這個詞以你輸入的字串開頭') },
  suffix: { label: msg('結尾相符'), hint: msg('這個詞以你輸入的字串結尾') },
  substring: { label: msg('包含'), hint: msg('這個詞裡面含有你輸入的字串') },
  lemma: { label: msg('自動拆解'), hint: msg('演算法自動去掉詞綴後得到這個詞；是推定的結果，不是確定的分析') },
  derived: { label: msg('自動派生'), hint: msg('演算法推定這個詞由你輸入的詞加上詞綴而來；是推定的結果，不是辭典的標註') },
  sibling: { label: msg('自動同根'), hint: msg('演算法推定這個詞與你輸入的詞來自同一個詞根；是推定的結果，不是辭典的標註') },
}
/**
 * 搜尋篩選的「搜尋方法」（babizu/search 的 SEARCH_METHODS），分成四組（key 與 SEARCH_METHOD_GROUPS 相同）：
 * 拼寫、部分符合、確定（辭典標註的構詞關係）、自動（演算法推定的構詞關係）。
 * note 是組名旁的次要說明（構詞關係的來源），與結果中的標籤用語一致。
 */
export const SEARCH_METHOD_GROUPS = [
  {
    key: 'spelling',
    label: msg('拼寫'),
    methods: [
      { id: 'exact', label: msg('完全相符'), hint: msg('拼寫正規化後與你輸入的相同') },
      { id: 'fuzzy', label: msg('相近拼寫'), hint: msg('方言的語音對應或少量拼寫差異（依模糊程度）') },
    ],
  },
  {
    key: 'partial',
    label: msg('部分符合'),
    methods: [
      { id: 'prefix', label: msg('開頭', '搜尋方法'), hint: msg('這個詞以你輸入的字串開頭') },
      { id: 'suffix', label: msg('結尾', '搜尋方法'), hint: msg('這個詞以你輸入的字串結尾') },
      { id: 'substring', label: msg('包含'), hint: msg('這個詞裡面含有你輸入的字串') },
    ],
  },
  {
    key: 'dictionary',
    label: msg('確定'),
    note: msg('辭典標註'),
    methods: [
      { id: 'dictLemma', label: msg('拆解'), hint: msg('辭典中你輸入的詞所屬的上層詞條（詞根）') },
      { id: 'dictDerived', label: msg('派生'), hint: msg('辭典列在你輸入的詞底下、或標明由它衍生的詞') },
      { id: 'dictSibling', label: msg('同根'), hint: msg('辭典中與你輸入的詞列在同一個詞底下的其他詞') },
    ],
  },
  {
    key: 'automatic',
    label: msg('自動'),
    note: msg('演算法推定'),
    methods: [
      { id: 'lemma', label: msg('拆解'), hint: msg('演算法自動去掉詞綴後得到的詞根') },
      { id: 'derived', label: msg('派生'), hint: msg('演算法推定由你輸入的詞加上詞綴而來的詞') },
      { id: 'sibling', label: msg('同根'), hint: msg('演算法推定與你輸入的詞來自同一個詞根') },
    ],
  },
]

/** @param {string} type */
export const matchTypeLabel = (type) => (type in MATCH_TYPES ? t(MATCH_TYPES[/** @type {keyof typeof MATCH_TYPES} */ (type)].label) : type)
/** @param {string} type */
export const matchTypeHint = (type) => (type in MATCH_TYPES ? t(MATCH_TYPES[/** @type {keyof typeof MATCH_TYPES} */ (type)].hint) : '')

/** 構詞音變的說明中，音變落在哪裡 */
export const MORPH_WHERE_LABELS = {
  prefix: msg('前綴', '位置'),
  stem: msg('詞幹'),
  suffix: msg('後綴', '位置'),
  junction: msg('詞素交界'),
}
/** @param {string} where */
export const morphWhereLabel = (where) => labelOf(MORPH_WHERE_LABELS, where)

/**
 * 語言變體（方言）名稱。站台設定沒有的代碼原樣顯示。
 * @param {string} code
 */
export function dialectLabel(code) {
  const variety = site.varieties.find((v) => v.code === code)
  return variety ? tr(variety.label) : code
}

/** 框架內建的書寫系統名稱 */
export const WRITING_SYSTEM_LABELS = { phonetic: msg('語音標記'), segmented: msg('分詞形式') }

/**
 * 書寫系統名稱：先查站台設定，再查框架內建的名稱，都沒有就顯示代碼。
 * @param {string} code
 */
export function writingSystemLabel(code) {
  const own = site.writingSystems[code]
  if (own) return tr(own)
  return labelOf(WRITING_SYSTEM_LABELS, code)
}

/**
 * 語言變體，依「上層在前、下層緊接其後」排列（例如 巴宰 → 巴宰（愛蘭）→ 噶哈巫），
 * 從屬的變體相鄰才看得出關係。
 */
export function orderedVarieties() {
  /** @type {typeof site.varieties} */
  const out = []
  const visit = (/** @type {string | null} */ parent) => {
    for (const v of site.varieties.filter((x) => x.parent === parent)) {
      out.push(v)
      visit(v.code)
    }
  }
  visit(null)
  return out
}

/**
 * 距離數字的顯示格式：最多兩位小數，去掉多餘的 0。
 * @param {number} value
 */
export function formatDistance(value) {
  if (!Number.isFinite(value)) return '∞'
  return String(Math.round(value * 100) / 100)
}

/**
 * 對齊步驟的簡短說明，例如「l→n」、「r→∅」、「∅→h」。
 * @param {{source: string, target: string}} step
 */
export function formatStep(step) {
  return `${step.source || '∅'}→${step.target || '∅'}`
}

/**
 * 由詞素構成的步驟（構詞文法的 parts，推導順序）依詞中的位置寫出來：
 * - 前綴那側：後加的前綴在外（左）；落在前綴上的中綴寫進最外層的前綴，插在它的首輔音之後（m<a>-、m<in>u-）
 * - 詞根上的中綴、重疊（第一個運算）另外回傳，由呼叫端放在詞根旁
 * - 後綴那側：依推導順序由內而外（-an、-ay）
 * @param {Array<{type: string, form: string}>} parts
 * @param {string} vowels 元音字母（決定首輔音）
 * @returns {{before: string, stemOp: string, after: string[]}}
 */
export function partsLayout(parts, vowels = site.profile?.morphology?.vowels ?? 'aeiouéə') {
  /** @type {string[]} 前綴那側的詞素（詞中的順序），中綴已插入 */
  const prefixes = []
  let stemOp = ''
  /** @type {string[]} */
  const after = []
  parts.forEach((p, k) => {
    if (p.type === 'prefix') prefixes.unshift(p.form)
    else if (p.type === 'suffix') after.push(`-${p.form}`)
    else if (k === 0) stemOp = p.type === 'infix' ? `<${p.form}>` : `${p.form}~`
    else if (p.type === 'infix' && prefixes.length) {
      const outer = Array.from(prefixes[0])
      let h = 0
      while (h < outer.length && !vowels.includes(outer[h])) h++
      prefixes[0] = [...outer.slice(0, h), `<${p.form}>`, ...outer.slice(h)].join('')
    } else stemOp = p.type === 'infix' ? `<${p.form}>` : `${p.form}~`
  })
  return { before: prefixes.length ? `${prefixes.join('-')}-` : '', stemOp, after }
}

/**
 * 構詞步驟的寫法：前綴 `mu-`、後綴 `-an`、中綴 `<in>`、重疊 `ba-`、詞幹交替 `t→d`、環綴 `ta-…-aw`。
 * 構詞文法的步驟由詞素構成時依 parts 寫出：組合規則 `m<a>-…-ay`、`m<in>u-`。
 * @param {{type: string, form: string, left?: {type: string, form: string}, suffix?: string, parts?: Array<{type: string, form: string}>}} step
 */
export function formatMorphStep(step) {
  if (step.parts && step.parts.length > 1) {
    const { before, stemOp, after } = partsLayout(step.parts)
    const core = [before, stemOp].filter(Boolean).join('')
    return after.length ? `${core}…${after.join('')}` : core
  }
  if (step.type === 'prefix' || step.type === 'reduplication') return `${step.form}-`
  if (step.type === 'suffix') return `-${step.form}`
  if (step.type === 'infix') return `<${step.form}>`
  if (step.type === 'alternation') return step.form.replace('>', '→')
  if (step.type === 'circumfix' && step.left) return circumfixLabel(/** @type {any} */ (step))
  return step.form
}

/** 構詞步驟類型的名稱 */
export const MORPH_STEP_LABELS = {
  prefix: msg('前綴'),
  suffix: msg('後綴'),
  infix: msg('中綴'),
  reduplication: msg('重疊'),
  alternation: msg('構詞音變'),
  circumfix: msg('環綴'),
  construction: msg('組合規則'),
}
/** @param {string} type */
export const morphStepLabel = (type) => labelOf(MORPH_STEP_LABELS, type)

/**
 * 詞綴的語法說明（語言設定檔中可以是字串或依語系提供）。
 * @param {string | Record<string, string> | null | undefined} gloss
 */
export function morphGloss(gloss) {
  if (!gloss) return ''
  return typeof gloss === 'string' ? gloss : tr(gloss)
}

/**
 * 構詞分析的摘要，依詞形中的位置排列：前綴、重疊 ＋ 詞幹 ＋ 中綴、交替 ＋ 後綴，
 * 例如「mu- + pa- + tuku + -an」。
 * @param {{stem: string, steps: Array<{type: string, form: string}>}} analysis
 */
export function morphSummary(analysis) {
  const outerFirst = analysis.steps
  const before = outerFirst.filter((s) => s.type === 'prefix' || s.type === 'reduplication').map(formatMorphStep)
  const inner = outerFirst.filter((s) => s.type === 'infix' || s.type === 'alternation').map(formatMorphStep)
  // 後綴由外而內記錄，由左而右顯示要反過來
  const after = outerFirst.filter((s) => s.type === 'suffix').reverse().map(formatMorphStep)
  // 環綴緊貼詞幹：左邊是最內層的前綴（或詞幹上的中綴、重疊），後綴是最內層的後綴
  const circ = /** @type {any} */ (outerFirst.find((s) => s.type === 'circumfix'))
  if (circ?.parts?.length > 1) {
    // 構詞文法的組合規則：依詞素寫出（m<a>- + usa + -ay）
    const layout = partsLayout(circ.parts)
    if (layout.before) before.push(layout.before)
    if (layout.stemOp) (layout.stemOp.startsWith('<') ? inner.unshift(layout.stemOp) : before.push(layout.stemOp))
    after.unshift(...layout.after)
  } else if (circ?.left) {
    const { type, form } = circ.left
    // 中綴、重疊式環綴外側緊貼詞幹的前綴（m-<a>）
    if (circ.outer) before.push(`${circ.outer}-`)
    if (type === 'infix') inner.unshift(`<${form}>`)
    else before.push(type === 'prefix' ? `${form}-` : `${form}~`)
    if (circ.suffix) after.unshift(`-${circ.suffix}`)
  }
  return [...before, analysis.stem, ...inner, ...after].join(' + ')
}

/**
 * 秒數 → mm:ss.cc
 * @param {number} seconds
 */
export function formatTimecode(seconds) {
  const cs = Math.round(seconds * 100)
  const m = Math.floor(cs / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

/**
 * 記錄頁的路由位置。
 * @param {string} id 記錄 id（source:localId）
 */
export function recordRoute(id) {
  const k = id.indexOf(':')
  return { name: 'record', params: { source: id.slice(0, k), localId: id.slice(k + 1) } }
}

/**
 * 來源的分片單位名稱（「頁」「章」「場次」…）。來源資料裡寫的是資料本身的語言，
 * 所以預設語系直接用它，其他語系改用依瀏覽模式的通用名稱（SHARD_LABELS）。
 * @param {{browse?: {mode: string, shardLabel: string}} | null | undefined} source
 */
export function shardUnitLabel(source) {
  if (!source?.browse) return ''
  if (locale.value === site.defaultLocale) return source.browse.shardLabel
  return labelOf(SHARD_LABELS, source.browse.mode)
}

/** 瀏覽模式 → 分片單位的通用名稱 */
export const SHARD_LABELS = { page: msg('頁'), category: msg('類'), list: msg('部分'), recording: msg('場次') }

/** 網站名稱（依目前語系） */
export const siteTitle = () => tr(site.title)

/**
 * 語音規則分類的顯示名稱。分類名稱來自語言設定檔；規則群組可以另外提供
 * `label: { 'zh-TW': …, en: … }` 讓分類名稱也能翻譯，沒有就顯示原本的 category。
 * @param {string | null | undefined} category
 */
export function categoryLabel(category) {
  if (!category) return ''
  const group = /** @type {any[]} */ (site.profile?.rules ?? []).find((g) => g.category === category)
  return group?.label ? tr(group.label) || category : category
}

/** 語言設定檔的基本成本與最低的規則權重（說明「為什麼算相近」時用） */
export const COSTS = (() => {
  const costs = /** @type {any} */ (site.profile?.costs ?? {})
  const weights = /** @type {any[]} */ (site.profile?.rules ?? []).flatMap((g) => g.rules.map((r) => (Array.isArray(r) ? r[2] : r.weight)))
  return {
    substitute: costs.substitute ?? 1,
    delete: costs.delete ?? 1,
    insert: costs.insert ?? 1,
    rule: weights.length ? Math.min(...weights) : null,
  }
})()

/** 規則的適用位置（演算法實驗室） */
export const POSITION_LABELS = { any: msg('任何位置'), initial: msg('詞首'), final: msg('詞尾') }
/** @param {string} position */
export const positionLabel = (position) => labelOf(POSITION_LABELS, position)

/** 編輯操作的成本名稱（演算法實驗室的成本設定） */
export const COST_LABELS = { substitute: msg('替換'), delete: msg('刪除'), insert: msg('插入'), space: msg('空白（三種操作）') }
/** @param {string} kind */
export const costLabel = (kind) => labelOf(COST_LABELS, kind)

/** 模糊程度 */
export const FUZZINESS_LABELS = { exact: msg('精確'), normal: msg('標準'), loose: msg('寬鬆') }
/** @param {string} level */
export const fuzzinessLabel = (level) => labelOf(FUZZINESS_LABELS, level)

/** 搜尋範圍 */
export const FIELD_LABELS = {
  native: { label: msg('族語'), hint: msg('詞形、變體、其他書寫系統，以及句子中的詞') },
  gloss: { label: msg('釋義'), hint: msg('中文、英文、臺語譯解') },
}

/** 構詞規格的各項清單（演算法實驗室的規格摘要） */
export const SPEC_LABELS = {
  prefixes: msg('前綴', '規格清單'),
  suffixes: msg('後綴', '規格清單'),
  infixes: msg('中綴', '規格清單'),
  reduplication: msg('重疊型式'),
  alternations: msg('構詞音變', '規格清單'),
}
/** @param {string} key */
export const specLabel = (key) => labelOf(SPEC_LABELS, key)
