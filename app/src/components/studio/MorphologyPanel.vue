<script setup lang="ts">
/**
 * 工作台的「構詞」分頁：詞素（前綴、後綴、中綴、重疊）、允許的詞綴組合、構詞音變與幾個參數。
 * 有了構詞規格，搜尋會自動拆解詞綴（查衍生詞找詞根），實驗室多一個「構詞 BCDP」分頁。
 *
 * 編輯的是構詞文法（詞素與組合規則），與 pazeh-kaxabu 等正式站台的設定檔同一種寫法、同一個編譯與搜尋程式。
 * 為什麼要有「允許的詞綴組合」：單獨列出前綴 pu-、中綴 <a>、後綴 -ay，搜尋拆不出 pausunguday（p<a>u-sungud-ay，
 * <a> 落在前綴 pu 裡面）；要設定這三個詞素依序組成的組合，搜尋才認得。
 * 舊的專案是平面清單寫法：第一次修改詞素或組合時轉成等價的文法（playground/morphology.ts 的 flatToGrammar）。
 * 轉不了的（手寫的 stemInitial 環綴等）說明原因，請到「進階」分頁編輯 JSON。
 */
import { ArrowLeftIcon, ArrowRightIcon, PlusIcon, Trash2Icon, XIcon } from '@lucide/vue'
import { expandGrammar, REDUPLICATION_PATTERNS, validateGrammar, type ConstructionSpec, type GrammarSpec, type MorphemeSpec, type MorphologySpec, type ReduplicationPattern } from '#bcdp'
import { computed, reactive } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { msg, t } from '@/i18n.ts'
import { formatMorphStep, site, specLabel } from '@/lib/labels.ts'
import { askConfirm } from '@/playground/confirm.ts'
import { issuePaths, draft as studioDraft } from '@/playground/studio.ts'
import {
  constructionsUsing,
  formsText,
  glossOf,
  grammarOf,
  isGrammar,
  morphemeLabel,
  newConstruction,
  newMorpheme,
  removeMorpheme,
  setForms,
  setGloss,
  type MorphemeType,
} from '@babizu/playground/morphology.ts'

/** 草稿（以 reactive 取用：模板裡直接改它的欄位，Vue 才知道它不是 ref） */
const draft = reactive(studioDraft)

/** 草稿裡的構詞規格（平面清單或文法） */
const raw = computed(() => draft.profile.morphology ?? null)
/** 與平面清單共用的欄位（構詞音變、參數）直接改草稿；兩種寫法都一樣 */
const spec = computed(() => raw.value as MorphologySpec | null)
const conversion = computed(() => grammarOf(raw.value))
/** 編輯用的文法：已經是文法就是草稿本身，平面清單是等價的轉換結果（還沒寫回草稿） */
const grammar = computed(() => (conversion.value?.ok ? conversion.value.grammar : null))
const flat = computed(() => !!raw.value && !isGrammar(raw.value))
const morphemes = computed(() => grammar.value?.morphemes ?? [])
const constructions = computed(() => grammar.value?.constructions ?? [])

/**
 * 結構的修改：複製一份文法、修改、整份寫回草稿。平面清單的專案在這裡轉成文法（只有第一次）。
 */
function commit(mutate: (g: GrammarSpec) => void) {
  const g = JSON.parse(JSON.stringify(grammar.value)) as GrammarSpec
  mutate(g)
  const wasFlat = flat.value
  draft.profile.morphology = g as never
  if (wasFlat) toast.info(t('這份設定檔原本是平面清單的寫法，已轉成詞素與允許的詞綴組合（搜尋結果相同）。'))
}
const edit = (id: string, change: (m: MorphemeSpec) => void) =>
  commit((g) => {
    const m = g.morphemes?.find((x) => x.id === id)
    if (m) change(m)
  })

async function enable(on: boolean) {
  if (on) draft.profile.morphology = { minStem: 3, morphemes: [], constructions: [] } as never
  else if (await askConfirm({ title: t('關掉構詞？'), message: t('關掉構詞會刪掉所有詞綴與構詞音變。要保留，請先匯出專案檔。'), confirm: t('關掉構詞'), destructive: true })) delete draft.profile.morphology
}

const LISTS: Array<{ type: MorphemeType; key: 'prefixes' | 'suffixes' | 'infixes'; hint: string; example: string }> = [
  { type: 'prefix', key: 'prefixes', hint: msg('加在詞前面，例如 ma-（寫 ma）。同一個詞綴的幾個形式用逗號分開，例如 m, mu, mi, me'), example: 'ma' },
  { type: 'suffix', key: 'suffixes', hint: msg('加在詞後面，例如 -an（寫 an）'), example: 'an' },
  { type: 'infix', key: 'infixes', hint: msg('插在第一個輔音之後，例如 <in>（寫 in）'), example: 'in' },
]
const rowsOf = (type: MorphemeType) => morphemes.value.map((m, i) => ({ m, i })).filter(({ m }) => m.type === type)
const invalid = (path: string) => issuePaths.value.has(path) || undefined
/** 說明依介面的預設語系顯示與修改 */
const locale = site.defaultLocale
const gloss = (m: { gloss?: MorphemeSpec['gloss'] }) => glossOf(m.gloss, locale)

/**
 * 寫法輸入框：輸入的過程立刻寫回（檢查與「建置」按鈕即時更新），但輸入框顯示使用者打的原文
 * （「m, 」打到一半不能被整理掉）；離開輸入框才改成整理過的樣子
 */
const formsDraft = reactive<Record<string, string>>({})
function typeFormsOf(id: string, text: string) {
  formsDraft[id] = text
  edit(id, (x) => setForms(x, text))
}

function addMorpheme(type: MorphemeType) {
  commit((g) => (g.morphemes ??= []).push(newMorpheme(g, type)))
}
async function removeRow(m: MorphemeSpec) {
  const used = constructionsUsing(grammar.value as GrammarSpec, m.id)
  if (used.length && !(await askConfirm({ title: t('刪除詞素「{name}」？', { name: morphemeLabel(m) }), message: t('{count} 個允許的詞綴組合用到它，會一起刪除。', { count: used.length }), confirm: t('刪除'), destructive: true }))) return
  commit((g) => void removeMorpheme(g, m.id))
}

/** 重疊型式的說明 */
const PATTERN_HINTS: Record<ReduplicationPattern, string> = {
  Ca: msg('首輔音＋a（ta~tuba）'),
  CV: msg('第一個音節（ki~kiliw）'),
  CVV: msg('音節＋長元音（luu~luzu）'),
  CGV: msg('輔音＋滑音＋元音（ria~riak）；要填滑音'),
  CVG: msg('輔音＋元音＋滑音（bai~bair）；要填滑音'),
  CVCV: msg('前兩個音節'),
  CVCVC: msg('前兩個音節＋輔音'),
  full: msg('整個詞'),
}
/** 需要宣告滑音（glides）才能用的型式 */
const NEEDS_GLIDES = new Set<ReduplicationPattern>(['CGV', 'CVG'])
/** 同一種型式（自由的）列了不只一次 */
const duplicatePattern = (m: MorphemeSpec) => m.free !== false && morphemes.value.findIndex((x) => x.type === 'reduplication' && x.free !== false && x.pattern === m.pattern) !== morphemes.value.indexOf(m)

// ── 允許的詞綴組合 ──
/** 下拉選單中的詞素：寫法與說明 */
const optionLabel = (m: MorphemeSpec) => `${morphemeLabel(m)}${gloss(m) ? `　${gloss(m)}` : ''}`
function addConstruction() {
  commit((g) => {
    // 預設兩個詞素：最常見的是前綴加後綴，沒有就取前兩個
    const ms = g.morphemes ?? []
    const first = ms.find((m) => m.type === 'prefix') ?? ms[0]
    const second = ms.find((m) => m.type === 'suffix' && m !== first) ?? ms.find((m) => m !== first)
    if (first && second) (g.constructions ??= []).push(newConstruction(g, [first.id, second.id]))
  })
}
const editConstruction = (id: string, change: (c: ConstructionSpec) => void) =>
  commit((g) => {
    const c = g.constructions?.find((x) => x.id === id)
    if (c) change(c)
  })
function moveMember(c: ConstructionSpec, k: number, by: -1 | 1) {
  editConstruction(c.id, (x) => {
    const [item] = x.sequence.splice(k, 1)
    x.sequence.splice(k + by, 0, item)
  })
}

/**
 * 組合規則展開的結果（依推導順序由詞素組成，例如 pu-、<a>、-ay → p<a>u-…-ay）：
 * 與搜尋用的是同一個展開（expandGrammar）。推導不出來時回報原因（例如兩個中綴都落在詞根上）
 */
function preview(c: ConstructionSpec): { labels: string[]; error: string | null } {
  const g = grammar.value as GrammarSpec
  const { morphemes: _m, constructions: _c, ...shared } = g
  const sub = { ...shared, morphemes: (g.morphemes ?? []).map((m) => ({ ...m, free: false })), constructions: [c] } as GrammarSpec
  const errors = validateGrammar(sub as unknown as Record<string, unknown>).filter((e) => e.startsWith('morphology.constructions[0]'))
  if (errors.length) return { labels: [], error: errors[0].replace(/^morphology\.constructions\[0\]（[^）]*）：/u, '') }
  try {
    const x = expandGrammar(sub)
    const entries = [...x.prefixes, ...x.suffixes, ...x.infixes, ...x.reduplication, ...x.circumfixes]
    const labels = entries.map((e) => formatMorphStep({ type: 'circumfix', form: '', parts: e.parts }))
    return { labels: [...new Set(labels)], error: null }
  } catch {
    return { labels: [], error: null }
  }
}
/** 組合規則的說明文字（推導順序的詞素寫成 pu- ＋ <a> ＋ -ay） */
const sequenceText = (c: ConstructionSpec) => c.sequence.map((id) => morphemes.value.find((m) => m.id === id)).filter(Boolean).map((m) => morphemeLabel(m as MorphemeSpec)).join(' ＋ ')

// ── 構詞音變、參數（兩種寫法共用，直接改草稿） ──
type AlternationSpec = NonNullable<MorphologySpec['alternations']>[number]
const POSITIONS: Array<{ value: NonNullable<AlternationSpec['position']>; label: string }> = [
  { value: 'final', label: msg('詞素末') },
  { value: 'initial', label: msg('詞素首') },
  { value: 'any', label: msg('任何位置') },
]
function addAlternation() {
  ;((spec.value as MorphologySpec).alternations ??= []).push({ underlying: '', surface: '', position: 'final' })
}

/** 數值參數：空白表示用預設值 */
const NUMBERS = [
  { key: 'minStem', label: msg('詞根最短長度'), fallback: 3, step: 1 },
  { key: 'cost', label: msg('每個構詞步驟的成本'), fallback: 0.3, step: 0.05 },
  { key: 'maxSteps', label: msg('前綴、後綴各最多幾個'), fallback: 3, step: 1 },
] as const
function setNumber(key: 'minStem' | 'cost' | 'maxSteps', value: string) {
  const s = spec.value as MorphologySpec
  if (value.trim() === '') delete s[key]
  else s[key] = Number(value)
}
function setText(key: 'vowels' | 'glides', value: string) {
  const s = spec.value as MorphologySpec
  if (value.trim() === '') delete s[key]
  else s[key] = value.trim()
}
</script>

<template>
  <div class="space-y-8">
    <p class="text-muted-foreground max-w-3xl text-sm leading-relaxed">
      {{ t('列出這個語言的詞綴，搜尋就會自動拆解：查衍生詞找得到詞根，查詞根也找得到衍生詞。兩個方言的詞綴不同也沒關係，兩邊的都列進來。') }}
    </p>

    <label class="flex items-center gap-2 text-sm font-medium">
      <Checkbox :model-value="!!raw" @update:model-value="(v) => enable(v === true)" />
      {{ t('使用構詞（自動拆解詞綴）') }}
    </label>

    <p v-if="raw && conversion && !conversion.ok" class="rounded-lg border border-dashed p-6 text-sm leading-relaxed">
      {{ t('這份設定檔的構詞用了這裡編輯不了的寫法：{reason}。請到「進階」分頁編輯 JSON。', { reason: conversion.reason }) }}
    </p>

    <template v-else-if="raw && grammar && spec">
      <p v-if="flat" class="bg-muted/40 max-w-3xl rounded-lg border p-3 text-xs leading-relaxed">
        {{ t('這份設定檔是平面清單的寫法。下面顯示的是等價的詞素與允許的詞綴組合（環綴就是組合）；修改任何一項時才會寫回，搜尋結果相同。') }}
      </p>

      <section v-for="list in LISTS" :key="list.type" class="max-w-3xl space-y-2">
        <div class="flex items-baseline justify-between gap-2">
          <h2 class="font-semibold">{{ specLabel(list.key) }}</h2>
          <Button variant="ghost" size="sm" @click="addMorpheme(list.type)"><PlusIcon />{{ t('新增') }}</Button>
        </div>
        <p class="text-muted-foreground text-xs">{{ t(list.hint) }}</p>
        <div v-for="{ m, i } in rowsOf(list.type)" :key="m.id" class="flex flex-wrap items-center gap-2" :data-path="`profile.morphology.morphemes[${i}]`">
          <Input
            class="native-text h-8 w-36 font-mono"
            :model-value="formsDraft[m.id] ?? formsText(m)"
            :placeholder="list.example"
            :aria-label="t('寫法')"
            :aria-invalid="invalid(`profile.morphology.morphemes[${i}]`)"
            @update:model-value="(v) => typeFormsOf(m.id, String(v))"
            @blur="delete formsDraft[m.id]"
          />
          <Input class="h-8 min-w-0 flex-[1_1_8rem]" :model-value="gloss(m)" :placeholder="t('意思（選填）')" :aria-label="t('意思')" @update:model-value="(v) => edit(m.id, (x) => setGloss(x, String(v), locale))" />
          <label class="text-muted-foreground flex items-center gap-1.5 text-xs" :title="t('勾選：這個詞素只在「允許的詞綴組合」裡出現，不會單獨當成詞綴拆解')">
            <Checkbox :model-value="m.free === false" :aria-label="t('只在組合裡出現')" @update:model-value="(v) => edit(m.id, (x) => (v === true ? (x.free = false) : delete x.free))" />
            {{ t('只在組合裡出現') }}
          </label>
          <Button variant="ghost" size="icon" :aria-label="t('刪除')" @click="removeRow(m)"><Trash2Icon /></Button>
        </div>
      </section>

      <section class="max-w-3xl space-y-2">
        <div class="flex items-baseline justify-between gap-2">
          <h2 class="font-semibold">{{ specLabel('reduplication') }}</h2>
          <Button variant="ghost" size="sm" @click="addMorpheme('reduplication')"><PlusIcon />{{ t('新增') }}</Button>
        </div>
        <p class="text-muted-foreground text-xs">{{ t('重疊用 ~ 表示，例如 ki~kiliw：重疊的部分在 ~ 之前。選擇是哪一種重疊（重疊哪一段），再寫它的意思。') }}</p>
        <p v-if="!rowsOf('reduplication').length" class="text-muted-foreground text-sm">{{ t('還沒有重疊。按「新增」加一種。') }}</p>
        <div v-for="{ m, i } in rowsOf('reduplication')" :key="m.id" class="space-y-1" :data-path="`profile.morphology.morphemes[${i}]`">
          <div class="flex flex-wrap items-center gap-2">
            <select
              :value="m.pattern"
              class="border-input bg-background h-8 min-w-0 flex-[1_1_14rem] rounded-md border px-2 text-sm sm:flex-none"
              :aria-label="t('這一列的重疊型式')"
              :aria-invalid="duplicatePattern(m) || invalid(`profile.morphology.morphemes[${i}]`)"
              @change="(e) => edit(m.id, (x) => (x.pattern = (e.target as HTMLSelectElement).value as ReduplicationPattern))"
            >
              <option v-for="p in REDUPLICATION_PATTERNS" :key="p" :value="p">{{ p }}　{{ t(PATTERN_HINTS[p]) }}</option>
            </select>
            <Input class="h-8 min-w-0 flex-[2_1_10rem]" :model-value="gloss(m)" :placeholder="t('意思（選填）')" :aria-label="t('重疊的意思')" @update:model-value="(v) => edit(m.id, (x) => setGloss(x, String(v), locale))" />
            <label class="text-muted-foreground flex items-center gap-1.5 text-xs" :title="t('勾選：這個詞素只在「允許的詞綴組合」裡出現，不會單獨當成詞綴拆解')">
              <Checkbox :model-value="m.free === false" :aria-label="t('只在組合裡出現')" @update:model-value="(v) => edit(m.id, (x) => (v === true ? (x.free = false) : delete x.free))" />
              {{ t('只在組合裡出現') }}
            </label>
            <Button variant="ghost" size="icon" :aria-label="t('刪除')" @click="removeRow(m)"><Trash2Icon /></Button>
          </div>
          <p v-if="m.pattern && NEEDS_GLIDES.has(m.pattern) && !spec.glides" class="text-destructive text-xs">{{ t('{pattern} 要在下面的「可以當滑音的元音」填上滑音（例如 iu）。', { pattern: m.pattern }) }}</p>
          <p v-if="duplicatePattern(m)" class="text-muted-foreground text-xs">{{ t('這一種型式已經列過了。') }}</p>
        </div>
      </section>

      <section class="max-w-3xl space-y-2" data-section="constructions">
        <div class="flex items-baseline justify-between gap-2">
          <h2 class="font-semibold">{{ t('允許的詞綴組合') }}</h2>
          <Button variant="ghost" size="sm" :disabled="morphemes.length < 2" :title="morphemes.length < 2 ? t('先在上面至少列出兩個詞素') : undefined" @click="addConstruction"><PlusIcon />{{ t('新增') }}</Button>
        </div>
        <p class="text-muted-foreground text-xs leading-relaxed">
          {{ t('哪些詞綴可以依什麼順序一起出現，構成一個固定的構式。依「先加上去的在前」排列。例如 pausunguday 是 p<a>u-sungud-ay：先有前綴 pu-，再插入中綴 <a>（落在 pu 裡面），再加後綴 -ay。單獨列出這三個詞綴，搜尋拆不出來；要設定它們的組合。') }}
        </p>
        <p v-if="!constructions.length" class="text-muted-foreground text-sm">{{ t('還沒有組合。按「新增」設定一個。') }}</p>
        <div v-for="(c, k) in constructions" :key="c.id" class="space-y-2 rounded-lg border p-3" :data-path="`profile.morphology.constructions[${k}]`" :class="invalid(`profile.morphology.constructions[${k}]`) && 'border-destructive/50 bg-destructive/5'">
          <div class="flex flex-wrap items-center gap-2">
            <template v-for="(id, j) in c.sequence" :key="j">
              <span v-if="j > 0" class="text-muted-foreground" aria-hidden="true">＋</span>
              <span class="inline-flex items-center gap-0.5">
                <select
                  :value="id"
                  class="border-input bg-background h-8 max-w-44 min-w-0 rounded-md border px-1.5 text-sm"
                  :aria-label="t('第 {n} 個詞素', { n: j + 1 })"
                  :aria-invalid="!morphemes.some((m) => m.id === id) || undefined"
                  @change="(e) => editConstruction(c.id, (x) => (x.sequence[j] = (e.target as HTMLSelectElement).value))"
                >
                  <option v-if="!morphemes.some((m) => m.id === id)" :value="id" disabled>{{ t('（選擇詞素）') }}</option>
                  <option v-for="m in morphemes" :key="m.id" :value="m.id">{{ optionLabel(m) }}</option>
                </select>
                <Button v-if="j > 0" variant="ghost" size="icon-sm" class="size-6" :aria-label="t('往前移')" @click="moveMember(c, j, -1)"><ArrowLeftIcon /></Button>
                <Button v-if="j < c.sequence.length - 1" variant="ghost" size="icon-sm" class="size-6" :aria-label="t('往後移')" @click="moveMember(c, j, 1)"><ArrowRightIcon /></Button>
                <Button v-if="c.sequence.length > 2" variant="ghost" size="icon-sm" class="size-6" :aria-label="t('拿掉這個詞素')" @click="editConstruction(c.id, (x) => x.sequence.splice(j, 1))"><XIcon /></Button>
              </span>
            </template>
            <Button variant="outline" size="sm" class="h-8" :aria-label="t('加一個詞素')" @click="editConstruction(c.id, (x) => x.sequence.push((morphemes.find((m) => !x.sequence.includes(m.id)) ?? morphemes[0]).id))"><PlusIcon />{{ t('詞素') }}</Button>
            <Button variant="ghost" size="icon" class="ml-auto" :aria-label="t('刪除組合')" @click="commit((g) => (g.constructions = g.constructions?.filter((x) => x.id !== c.id)))"><Trash2Icon /></Button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Input class="h-8 min-w-0 flex-[1_1_12rem]" :model-value="gloss(c)" :placeholder="t('這個組合的意思（選填），例如 鋪設・非實現')" :aria-label="t('組合的意思')" @update:model-value="(v) => editConstruction(c.id, (x) => setGloss(x, String(v), locale))" />
          </div>
          <template v-for="p in [preview(c)]" :key="c.id">
            <p v-if="p.error" class="text-destructive text-xs leading-relaxed">{{ t('這個組合無法成立：{detail}', { detail: p.error }) }}</p>
            <p v-else-if="p.labels.length" class="text-muted-foreground text-xs">
              {{ t('搜尋拆出的樣子：') }}<code class="bg-muted native-text mx-0.5 rounded px-1" v-for="label in p.labels" :key="label">{{ label }}</code>
              <span class="sr-only">{{ sequenceText(c) }}</span>
            </p>
          </template>
        </div>
      </section>

      <section class="max-w-3xl space-y-2">
        <div class="flex items-baseline justify-between gap-2">
          <h2 class="font-semibold">{{ specLabel('alternations') }}</h2>
          <Button variant="ghost" size="sm" @click="addAlternation"><PlusIcon />{{ t('新增') }}</Button>
        </div>
        <p class="text-muted-foreground text-xs">{{ t('只在詞素交界發生的變化，例如詞根末的 t 在後綴前寫成 d（底層 t → 表面 d）。') }}</p>
        <div v-for="(alt, k) in spec.alternations ?? []" :key="k" class="flex flex-wrap items-center gap-2" :data-path="`profile.morphology.alternations[${k}]`">
          <Input v-model="alt.underlying" class="native-text h-8 w-24 font-mono" :aria-label="t('底層')" :placeholder="t('底層')" :aria-invalid="invalid(`profile.morphology.alternations[${k}]`)" />
          <span class="text-muted-foreground" aria-hidden="true">→</span>
          <Input v-model="alt.surface" class="native-text h-8 w-24 font-mono" :aria-label="t('表面')" :placeholder="t('表面')" />
          <select v-model="alt.position" class="border-input bg-background h-8 rounded-md border px-1 text-sm" :aria-label="t('位置')">
            <option v-for="p in POSITIONS" :key="p.value" :value="p.value">{{ t(p.label) }}</option>
          </select>
          <Button variant="ghost" size="icon" :aria-label="t('刪除')" @click="spec.alternations?.splice(k, 1)"><Trash2Icon /></Button>
        </div>
      </section>

      <section class="max-w-3xl space-y-2">
        <h2 class="font-semibold">{{ t('參數') }}</h2>
        <div class="flex flex-wrap gap-4">
          <label v-for="n in NUMBERS" :key="n.key" class="space-y-1 text-sm">
            <span class="text-muted-foreground text-xs">{{ t(n.label) }}</span>
            <Input type="number" min="0" :step="n.step" class="h-9 w-28 tabular-nums" :model-value="spec[n.key] ?? ''" :placeholder="String(n.fallback)" @update:model-value="(v) => setNumber(n.key, String(v))" />
          </label>
          <label class="space-y-1 text-sm">
            <span class="text-muted-foreground text-xs">{{ t('元音字母') }}</span>
            <Input class="native-text h-9 w-36 font-mono" :model-value="spec.vowels ?? ''" placeholder="aeiouéə" @update:model-value="(v) => setText('vowels', String(v))" />
          </label>
          <label class="space-y-1 text-sm">
            <span class="text-muted-foreground text-xs">{{ t('可以當滑音的元音') }}</span>
            <Input class="native-text h-9 w-28 font-mono" :model-value="spec.glides ?? ''" placeholder="iu" @update:model-value="(v) => setText('glides', String(v))" />
          </label>
        </div>
      </section>
    </template>
  </div>
</template>
