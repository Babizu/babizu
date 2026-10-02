/**
 * @file 站台設定：讀取、檢查、解析 `babizu.config.js`。
 *
 * 一個辭典網站就是「一份站台設定＋一份語言設定檔＋一份資料集」。
 * 站台設定描述網站本身：名稱、介面語系、語言變體（方言）、搜尋範例、「關於」頁內容等。
 * 完整欄位說明見 docs/site-config.md。
 *
 * ```js
 * // babizu.config.js
 * import { defineSite } from 'babizu'
 * export default defineSite({
 *   id: 'my-dictionary',
 *   locales: ['zh-TW', 'en'],
 *   title: { 'zh-TW': '某某語辭典', en: 'Some Language Dictionary' },
 *   language: 'language/profile.json',
 *   varieties: [{ code: 'north', hue: 55, label: { 'zh-TW': '北部', en: 'Northern' } }],
 * })
 * ```
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { marked } from 'marked'
import { validateProfile } from '../fuzzy/index.js'
import { PatternError } from '../pattern/errors.js'
import { parsePattern } from '../pattern/parser.js'
import { extractMessages } from './extract-messages.js'
import { BUILTIN_LOCALE_NAMES, BUILTIN_LOCALES, FRAMEWORK_ROOT, SOURCE_LOCALE, loadBuiltinMessages } from './paths.js'

/**
 * 可以依語系提供的文字：字串（所有語系共用）或 `{ 'zh-TW': …, en: … }`。
 * @typedef {string | Record<string, string>} Localized
 */

/**
 * @typedef {object} VarietyConfig 語言變體（方言）
 * @property {string} code 代碼（小寫英數與連字號），記錄的 dialects 欄位使用
 * @property {Localized} label 顯示名稱
 * @property {string | null} [parent] 所屬的上層變體；篩選上層時一併納入（例如愛蘭 ⊂ 巴宰）
 * @property {number} [hue] 色相（0–360）；未指定時繼承 parent 的色相，最上層預設依順序分配
 * @property {{light?: {fg: string, bg: string}, dark?: {fg: string, bg: string}}} [colors] 直接指定顏色（CSS 色值）
 */

/**
 * @typedef {object} SiteConfigInput `babizu.config.js` 匯出的內容
 * @property {string} id 站台代號（英數與連字號），用於瀏覽器儲存空間的前綴
 * @property {string[]} [locales] 介面語系，第一個（或 defaultLocale）是預設語系
 * @property {string} [defaultLocale]
 * @property {Record<string, string>} [localeNames] 語系顯示名稱（框架內建語系已有名稱）
 * @property {Localized} title 網站名稱
 * @property {Localized} [shortTitle] 窄螢幕用的短名稱
 * @property {Localized} [description] 網站說明（首頁與 meta description）
 * @property {string} [language] 語言設定檔路徑，預設 `language.json`
 * @property {string} [data] 資料集目錄，預設 `data`
 * @property {string} [publicDir] 靜態檔目錄（站徽等），預設 `public`
 * @property {string} [icon] 站徽（相對 publicDir），預設 `icon.jpg`（不存在則不顯示）
 * @property {string} [themeColor] 行動瀏覽器的網址列顏色
 * @property {VarietyConfig[]} [varieties]
 * @property {Record<string, Localized>} [writingSystems] 書寫系統代碼 → 顯示名稱（記錄 altTexts 使用）
 * @property {string[]} [specialChars] 搜尋框的特殊字元快捷鍵
 * @property {Array<{q: string, note?: Localized}>} [examples] 首頁的搜尋範例
 * @property {Array<{q: string, note?: Localized}>} [patternExamples] 「關於」頁句型搜尋說明的例子（句型查詢，建置時檢查寫法；docs/pattern-query.md）
 * @property {Localized} [about] 「關於」頁內容：Markdown 檔路徑（可依語系分開）
 * @property {Localized} [footer] 頁尾文字
 * @property {{pairs?: Array<[string, string]>, words?: string, morph?: {examples?: Array<[string, string]>, failures?: Array<[string, string]>}}} [lab]
 *   演算法實驗室的預設輸入：`pairs` 是可以一鍵帶入的詞對（第一組是預設值），`words` 是詞圖示範的詞庫（以空白分隔），
 *   `morph` 是構詞（BCDP）分頁的例子：`examples` 是 [查詢, 詞根]（第一組是預設值），`failures` 是找不到的例子
 *   （分頁會說明原因）。只有語言設定檔有 `morphology` 時才能設定
 * @property {string} [messages] 介面字串覆寫與額外語系的目錄，預設 `locales`
 */

/**
 * 定義站台設定（只是回傳原物件，用來取得編輯器型別提示）。
 * @param {SiteConfigInput} config
 */
export function defineSite(config) {
  return config
}

const CODE = /^[a-z][a-z0-9-]*$/

/**
 * 把 Localized 攤成每個語系都有值的物件（缺的語系回退到預設語系）。
 * @param {Localized | undefined} value
 * @param {string[]} locales
 * @param {string} fallbackLocale
 * @returns {Record<string, string> | null}
 */
export function localize(value, locales, fallbackLocale) {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return Object.fromEntries(locales.map((l) => [l, value]))
  const fallback = value[fallbackLocale] ?? Object.values(value)[0] ?? ''
  return Object.fromEntries(locales.map((l) => [l, value[l] ?? fallback]))
}

/**
 * 檢查一份譯文檔：扁平的「中文原文 → 譯文」物件，值都是字串。
 * @param {unknown} table
 * @param {string} file 錯誤訊息用的檔名
 * @param {string[]} errors
 * @returns {Record<string, string>}
 */
function checkMessages(table, file, errors) {
  if (!table || typeof table !== 'object' || Array.isArray(table)) {
    errors.push(`${file}：必須是「中文原文 → 譯文」的物件`)
    return {}
  }
  /** @type {Record<string, string>} */
  const out = {}
  for (const [k, v] of Object.entries(table)) {
    if (typeof v === 'string') out[k] = v
    else errors.push(`${file}：「${k}」的譯文必須是字串（譯文檔是扁平的，鍵是中文原文）`)
  }
  return out
}

/**
 * 依序分配預設色相，讓沒指定顏色的變體也能彼此區分。
 * 選用在淺色背景上都夠清楚、彼此差距大的色相。
 */
const DEFAULT_HUES = [55, 175, 265, 330, 115, 20, 215, 85]

/**
 * 語言變體的顏色（OKLCH）。從屬變體用同色相、較低彩度，表示「包含於上層」。
 * @param {number} hue
 * @param {boolean} child
 */
export function varietyColors(hue, child) {
  const c = child ? 0.45 : 1
  return {
    light: { fg: `oklch(${child ? 0.5 : 0.47} ${(0.1 * c).toFixed(3)} ${hue})`, bg: `oklch(0.955 ${(0.03 * c).toFixed(3)} ${hue})` },
    dark: { fg: `oklch(${child ? 0.8 : 0.82} ${(0.09 * c).toFixed(3)} ${hue})`, bg: `oklch(${child ? 0.3 : 0.31} ${(0.04 * c).toFixed(3)} ${hue})` },
  }
}

/**
 * 讀取並解析站台設定。回傳的物件是「解析後的設定」：路徑都是絕對路徑、文字都依語系攤開、
 * Markdown 已轉成 HTML、介面字串已合併框架預設與站台覆寫。
 *
 * @param {string} siteDir 站台根目錄（有 babizu.config.js 的地方）
 */
export async function loadSiteConfig(siteDir) {
  const root = resolve(siteDir)
  const configFile = join(root, 'babizu.config.js')
  if (!existsSync(configFile)) throw new Error(`找不到站台設定 ${configFile}`)
  /** @type {SiteConfigInput} */
  const input = (await import(`${pathToFileURL(configFile).href}?t=${Date.now()}`)).default
  const errors = []

  if (!input?.id || !CODE.test(input.id)) errors.push('id 必須是小寫英數與連字號，例如 "my-dictionary"')
  const locales = input.locales?.length ? [...input.locales] : ['zh-TW']
  const defaultLocale = input.defaultLocale ?? locales[0]
  if (!locales.includes(defaultLocale)) errors.push(`defaultLocale「${defaultLocale}」不在 locales 中`)
  if (!input.title) errors.push('缺少 title')

  // 介面字串：中文原文直接寫在程式裡，其他語系是「中文原文 → 譯文」的對照表：
  // 框架內建的譯文 ＋ 站台目錄 locales/<語系>.json（覆寫或新增；中文也可以覆寫）。
  // 允許先開放一個語系、之後再慢慢翻譯：缺的字串在瀏覽器端回退到預設語系、再回退到中文
  // （`babizu locales` 列出缺哪些）
  const messagesDir = join(root, input.messages ?? 'locales')
  const builtin = await loadBuiltinMessages()
  /** @type {Record<string, Record<string, string>>} */
  const messages = {}
  /** 站台自己的譯文檔（檢查失效的覆寫用） @type {Record<string, Record<string, string>>} */
  const overrides = {}
  for (const locale of locales) {
    const file = join(messagesDir, `${locale}.json`)
    const own = existsSync(file) ? checkMessages(JSON.parse(await readFile(file, 'utf8')), file, errors) : {}
    if (existsSync(file)) overrides[locale] = own
    messages[locale] = { ...(builtin[locale] ?? {}), ...own }
  }
  if (defaultLocale !== SOURCE_LOCALE && Object.keys(messages[defaultLocale] ?? {}).length === 0) {
    errors.push(`預設語系「${defaultLocale}」沒有任何譯文；框架內建語系：${BUILTIN_LOCALES.join('、')}`)
  }
  const localeNames = Object.fromEntries(locales.map((l) => [l, input.localeNames?.[l] ?? BUILTIN_LOCALE_NAMES[l] ?? l]))

  // 語言設定檔
  const languageFile = join(root, input.language ?? 'language.json')
  /** @type {import('../fuzzy/profile.js').LanguageProfile | null} */
  let profile = null
  if (!existsSync(languageFile)) errors.push(`找不到語言設定檔 ${languageFile}`)
  else {
    profile = JSON.parse(await readFile(languageFile, 'utf8'))
    for (const e of validateProfile(profile)) errors.push(`語言設定檔：${e}`)
  }

  // 句型搜尋的例子：寫法要剖析得過（構詞樣式的詞綴要等到搜尋時才依構詞規格解析）
  for (const [k, e] of (input.patternExamples ?? []).entries()) {
    if (typeof e?.q !== 'string' || !e.q.trim()) {
      errors.push(`patternExamples[${k}].q 必須是非空字串`)
      continue
    }
    try {
      parsePattern(e.q)
    } catch (err) {
      if (!(err instanceof PatternError)) throw err
      errors.push(`patternExamples[${k}]「${e.q}」不是合法的句型（${err.code}，位置 ${err.start}–${err.end}）`)
    }
  }

  // 演算法實驗室的構詞例子
  const morphLab = input.lab?.morph
  if (morphLab !== undefined) {
    if (profile && !profile.morphology) errors.push('lab.morph 只能在語言設定檔有 morphology 時設定')
    for (const key of /** @type {const} */ (['examples', 'failures'])) {
      const list = morphLab?.[key] ?? []
      const ok = Array.isArray(list) && list.every((p) => Array.isArray(p) && p.length === 2 && p.every((w) => typeof w === 'string' && w.trim()))
      if (!ok) errors.push(`lab.morph.${key} 必須是 [查詢, 詞根] 的陣列，兩者都是非空字串`)
    }
  }

  // 語言變體
  const varietyInput = input.varieties ?? []
  const codes = new Set()
  for (const v of varietyInput) {
    if (!CODE.test(v.code ?? '')) errors.push(`變體代碼「${v.code}」格式不正確`)
    if (codes.has(v.code)) errors.push(`變體代碼「${v.code}」重複`)
    codes.add(v.code)
  }
  for (const v of varietyInput) {
    if (v.parent && !codes.has(v.parent)) errors.push(`變體 ${v.code} 的 parent「${v.parent}」不存在`)
  }
  // 色相：最上層的變體先決定（沒指定就依序分配），下層變體沿用最上層祖先的色相，
  // 這樣不論清單中的順序如何，從屬的變體都和上層同色系
  /** @type {Map<string, number>} */
  const hues = new Map()
  let nextHue = 0
  for (const v of varietyInput) {
    if (!v.parent) hues.set(v.code, v.hue ?? DEFAULT_HUES[nextHue++ % DEFAULT_HUES.length])
  }
  /** @param {VarietyConfig} v @returns {number} */
  const hueOf = (v) => {
    if (v.hue !== undefined) return v.hue
    const seen = new Set()
    let cur = v
    while (cur.parent && !seen.has(cur.code)) {
      seen.add(cur.code)
      const parent = varietyInput.find((p) => p.code === cur.parent)
      if (!parent) break
      if (parent.hue !== undefined) return parent.hue
      cur = parent
    }
    return hues.get(cur.code) ?? DEFAULT_HUES[0]
  }
  const varieties = varietyInput.map((v) => {
    const hue = hueOf(v)
    const derived = varietyColors(hue, !!v.parent)
    return {
      code: v.code,
      parent: v.parent ?? null,
      label: localize(v.label, locales, defaultLocale) ?? Object.fromEntries(locales.map((l) => [l, v.code])),
      colors: { light: v.colors?.light ?? derived.light, dark: v.colors?.dark ?? derived.dark },
    }
  })

  // 「關於」頁：Markdown → HTML（可以依語系分檔；缺的語系用預設語系的內容）
  const aboutPaths = localize(input.about, locales, defaultLocale)
  /** @type {Record<string, string> | null} */
  let about = null
  if (aboutPaths) {
    about = {}
    for (const locale of locales) {
      const file = join(root, aboutPaths[locale])
      if (!existsSync(file)) {
        errors.push(`找不到「關於」頁內容 ${file}`)
        continue
      }
      about[locale] = await marked.parse(await readFile(file, 'utf8'))
    }
  }

  const publicDir = join(root, input.publicDir ?? 'public')
  const icon = input.icon ?? 'icon.jpg'

  if (errors.length > 0) throw new Error(`站台設定有誤（${configFile}）：\n- ${errors.join('\n- ')}`)

  return {
    root,
    configFile,
    frameworkRoot: FRAMEWORK_ROOT,
    dataDir: join(root, input.data ?? 'data'),
    publicDir,
    overrides,
    /** 會送進瀏覽器的部分（必須可以 JSON 序列化） */
    client: {
      id: input.id,
      locales,
      defaultLocale,
      localeNames,
      title: /** @type {Record<string, string>} */ (localize(input.title, locales, defaultLocale)),
      shortTitle: localize(input.shortTitle ?? input.title, locales, defaultLocale),
      description: localize(input.description, locales, defaultLocale),
      footer: localize(input.footer, locales, defaultLocale),
      icon: existsSync(join(publicDir, icon)) ? icon : null,
      themeColor: input.themeColor ?? '#2f3f7a',
      varieties,
      writingSystems: Object.fromEntries(
        Object.entries(input.writingSystems ?? {}).map(([code, label]) => [code, localize(label, locales, defaultLocale)]),
      ),
      specialChars: input.specialChars ?? [],
      examples: (input.examples ?? []).map((e) => ({ q: e.q, note: localize(e.note, locales, defaultLocale) })),
      patternExamples: (input.patternExamples ?? []).map((e) => ({ q: e.q, note: localize(e.note, locales, defaultLocale) })),
      about,
      lab: {
        pairs: input.lab?.pairs ?? [],
        words: input.lab?.words ?? null,
        morph: { examples: input.lab?.morph?.examples ?? [], failures: input.lab?.morph?.failures ?? [] },
      },
      messages,
      profile,
    },
  }
}

/** @typedef {Awaited<ReturnType<typeof loadSiteConfig>>} ResolvedSite */

/**
 * 找出各語系缺少的譯文：框架程式裡的介面字串（extract-messages.js）中，譯文表沒有的。
 * 原文語系（中文）不會缺。
 * @param {ResolvedSite} site
 * @returns {Record<string, string[]>}
 */
export function missingMessages(site) {
  const { messages, locales } = site.client
  const keys = extractMessages()
  return Object.fromEntries(
    locales.filter((l) => l !== SOURCE_LOCALE).map((l) => [l, keys.filter((k) => !(k in messages[l]))]),
  )
}

/**
 * 找出站台譯文檔中程式已經不再使用的鍵（多半是框架改了中文原文，覆寫因此失效）。
 * @param {ResolvedSite} site
 * @returns {Record<string, string[]>}
 */
export function unusedMessages(site) {
  const keys = new Set(extractMessages())
  return Object.fromEntries(Object.entries(site.overrides).map(([l, table]) => [l, Object.keys(table).filter((k) => !keys.has(k))]))
}
