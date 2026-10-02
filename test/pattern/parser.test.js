/**
 * 句型查詢的剖析（src/pattern/parser.js）與自動判斷（src/pattern/detect.js）。
 */

import { describe, expect, it } from 'vitest'
import { isPatternQuery, looksLikePattern } from '../../src/pattern/detect.js'
import { PatternError } from '../../src/pattern/errors.js'
import { parsePattern } from '../../src/pattern/parser.js'

/** 語法樹的精簡寫法（不含位置），方便比對 @param {any} n @returns {string} */
function show(n) {
  switch (n.type) {
    case 'atom': {
      const a = n.atom
      if (a.kind === 'any') return '_'
      if (a.kind === 'morph') return `M(${a.segments.map((s) => `${s.red ? '~' : ''}${s.quoted ? `"${s.host}"` : s.host}${s.infixes.map((x) => `<${x.form}>`).join('')}`).join('|')})`
      return `${a.kind}:${a.kind === 'glob' ? a.parts.join('…') : a.text}`
    }
    case 'not':
      return `!${show(n.node)}`
    case 'anchor':
      return n.at === 'start' ? '^' : '$'
    case 'seq':
      return `[${n.items.map(show).join(' ')}]`
    case 'alt':
      return `(${n.options.map(show).join('|')})`
    case 'repeat':
      return `${show(n.node)}{${n.min},${n.max === Infinity ? '' : n.max}}`
  }
  return '?'
}
/** @param {string} q */
const tree = (q) =>
  parsePattern(q)
    .conditions.map((c) => `${c.negated ? '¬' : ''}${show(c.body)}`)
    .join(' & ')
/** @param {string} q */
const error = (q) => {
  try {
    parsePattern(q)
  } catch (e) {
    if (e instanceof PatternError) return { code: e.code, at: q.slice(e.start, e.end) }
    throw e
  }
  return null
}

describe('剖析：詞的種類', () => {
  it('詞、引號、拼寫樣式、詞族、任一個詞', () => {
    expect(tree('kita')).toBe('word:kita')
    expect(tree('"kita"')).toBe('exact:kita')
    expect(tree('“kita”')).toBe('exact:kita')
    expect(tree('"yaku ka"')).toBe('[exact:yaku exact:ka]')
    expect(tree('pa…')).toBe('glob:pa…')
    expect(tree('pa...')).toBe('glob:pa…')
    expect(tree('…an')).toBe('glob:…an')
    expect(tree('…ki…')).toBe('glob:…ki…')
    expect(tree('@kita')).toBe('family:kita')
    expect(tree('_')).toBe('_')
  })

  it('構詞樣式：分段、中綴、重疊、引號、省略的詞根', () => {
    expect(tree('pa-…')).toBe('M(pa|…)')
    expect(tree('…-en')).toBe('M(…|en)')
    expect(tree('…=en')).toBe('M(…|en)')
    expect(tree('ta-…-i')).toBe('M(ta|…|i)')
    expect(tree('m<in>u-…')).toBe('M(mu<in>|…)')
    expect(tree('m<in>-…')).toBe('M(m<in>|…)')
    expect(tree('m-<in>…')).toBe('M(m|…<in>)')
    expect(tree('m-<in>-…')).toBe('M(m|<in>|…)')
    expect(tree('b<in>aket')).toBe('M(baket<in>)')
    expect(tree('~…')).toBe('M(~|…)')
    expect(tree('"mu"-…')).toBe('M("mu"|…)')
    // 頭尾省略的詞根：pa- ＝ pa-…、-en ＝ …-en
    expect(tree('pa-')).toBe('M(pa|…)')
    expect(tree('-en')).toBe('M(…|en)')
  })

  it('運算的結合：/ → 前置 ! → 量詞 → 相鄰 → | → &', () => {
    expect(tree('ki/ni hapuy')).toBe('[(word:ki|word:ni) word:hapuy]')
    expect(tree('ki/ni? hapuy')).toBe('[(word:ki|word:ni){0,1} word:hapuy]')
    expect(tree('!ki+ _')).toBe('[!word:ki{1,} _]')
    expect(tree('a b | c')).toBe('([word:a word:b]|word:c)')
    expect(tree('(yaku|isiw) ka')).toBe('[(word:yaku|word:isiw) word:ka]')
    expect(tree('(yaku ka)? _')).toBe('[[word:yaku word:ka]{0,1} _]')
    expect(tree('yaku ka _* isiw')).toBe('[word:yaku word:ka _{0,} word:isiw]')
    expect(tree('_{2} _{1,3} _{2,}')).toBe('[_{2,2} _{1,3} _{2,}]')
    expect(tree('^ _ ki')).toBe('[^ _ word:ki]')
    expect(tree('…-i $')).toBe('[M(…|i) $]')
  })

  it('& 與 !：& 後面的 ! 是「不能含有」；第一個條件開頭的 ! 是「不是這個詞」', () => {
    expect(tree('yaku & isiw')).toBe('word:yaku & word:isiw')
    expect(tree('yaku & !isiw')).toBe('word:yaku & ¬word:isiw')
    expect(tree('!ki _')).toBe('[!word:ki _]')
    expect(tree('yaku & (!ki) _')).toBe('word:yaku & [!word:ki _]')
    expect(tree('ki !(hapuy|saw)')).toBe('[word:ki !(word:hapuy|word:saw)]')
  })

  it('標點忽略並提示；pa* 與最後的 ? 提示', () => {
    expect(parsePattern('yaku, ka _').warnings.map((w) => w.code)).toEqual(['W_PUNCT'])
    expect(parsePattern('_ pa*').warnings.map((w) => w.code)).toEqual(['W_STAR_WORD'])
    expect(parsePattern('yaku _ isiw?').warnings.map((w) => w.code)).toEqual(['W_TRAILING_Q'])
  })
})

describe('剖析：錯誤代碼與位置', () => {
  it.each([
    ['_*', 'E_EMPTY_MATCH', '_*'],
    ['kita?', 'E_EMPTY_MATCH', 'kita?'],
    ['pa*', 'E_EMPTY_MATCH', 'pa*'],
    ['(_?)*', 'E_EMPTY_REPEAT', '(_?)*'],
    ['ki _ *', 'E_QUANT_POS', '*'],
    ['* ki', 'E_QUANT_POS', '*'],
    ['ki{0}', 'E_QUANT_RANGE', '{0}'],
    ['ki{3,1}', 'E_QUANT_RANGE', '{3,1}'],
    ['ki{x}', 'E_BAD_QUANT', '{x}'],
    ['(ki _', 'E_UNCLOSED_PAREN', '(ki _'],
    ['"ki', 'E_UNCLOSED_QUOTE', '"ki'],
    ['ki )', 'E_UNEXPECTED', ')'],
    ['ki |', 'E_EXPECTED_ITEM', '|'],
    ['ki &', 'E_EXPECTED_ITEM', '&'],
    ['ki !', 'E_EXPECTED_ITEM', '!'],
    ['ki/', 'E_EXPECTED_ITEM', '/'],
    ['!(ki _)', 'E_NEG_WIDTH', '!(ki _)'],
    ['!^', 'E_NEG_WIDTH', '!^'],
    ['a_b', 'E_UNDERSCORE', 'a_b'],
    ['@pa-…', 'E_FAMILY_FORM', '@pa-…'],
    ['m<in>…', 'E_WILDCARD_ATTACHED', 'm<in>…'],
    ['pa--…', 'E_EMPTY_SEGMENT', '--'],
    ['m<in', 'E_UNCLOSED_INFIX', '<in'],
    ['…-pa-…', 'E_MULTI_ROOT', '…-pa-…'],
    ['…', 'E_EMPTY_WORD', '…'],
    ['"m"u-…', 'E_QUOTE_POS', '"m"u'],
  ])('%s → %s', (q, code, at) => {
    expect(error(q)).toEqual({ code, at })
  })

  it('查詢太長、條件太多', () => {
    expect(error('_ '.repeat(130))?.code).toBe('E_TOO_LONG')
    expect(error(Array.from({ length: 33 }, () => 'a').join(' '))?.code).toBe('E_TOO_MANY')
  })
})

describe('自動判斷：只有句型專用的寫法才改用句型搜尋', () => {
  it.each([
    'kita',
    'pa-kita',
    'kita?',
    'pa*',
    'sikis-',
    'ha=ka',
    'mu daux',
    'bunang ka lalan!',
    'yaku (ka) mupuza lia.',
    "pakahatiken'ina!",
    '火',
    '「_」',
    'water',
    'ta-…-i 的意思',
    '',
  ])('一般搜尋：%s', (q) => {
    expect(looksLikePattern(q).pattern).toBe(false)
  })

  it.each([
    ['yaku ka _* isiw', '_'],
    ['pa-…', '…'],
    ['pa...', '…'],
    ['"yaku ka"', 'quote'],
    ['ki|ni', '|'],
    ['yaku & isiw', '&'],
    ['^ ki', '^'],
    ['ki $', '$'],
    ['!ki hapuy', '!'],
    ['ki _{2}', '_'],
    ['ki{2}', '{n}'],
    ['(yaku ka)? isiw', ')?'],
    ['@kita', '@'],
  ])('句型搜尋：%s（%s）', (q, reason) => {
    expect(looksLikePattern(q)).toEqual({ pattern: true, reason })
  })

  it('網址的 m 參數優先', () => {
    expect(isPatternQuery('kita', 'pattern')).toBe(true)
    expect(isPatternQuery('yaku ka _* isiw', 'plain')).toBe(false)
    expect(isPatternQuery('yaku ka _* isiw', null)).toBe(true)
    expect(isPatternQuery('', 'pattern')).toBe(false)
  })
})
