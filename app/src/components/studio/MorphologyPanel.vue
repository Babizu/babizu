<script setup lang="ts">
/**
 * 工作台的「構詞」分頁：構詞規格的平面清單（前綴、後綴、中綴、重疊型式、構詞音變）與幾個參數。
 * 有了構詞規格，搜尋會自動拆解詞綴（查衍生詞找詞根），實驗室多一個「構詞 BCDP」分頁。
 * 用構詞文法（morphemes、constructions）寫的設定檔在這裡不能編輯，請到「進階」分頁。
 */
import { PlusIcon, Trash2Icon } from '@lucide/vue'
import { REDUPLICATION_PATTERNS, type MorphologySpec, type ReduplicationPattern } from '#bcdp'
import { computed, reactive } from 'vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { msg, t } from '@/i18n.ts'
import { specLabel } from '@/lib/labels.ts'
import { askConfirm } from '@/playground/confirm.ts'
import { issuePaths, draft as studioDraft } from '@/playground/studio.ts'

/** 草稿（以 reactive 取用：模板裡直接改它的欄位，Vue 才知道它不是 ref） */
const draft = reactive(studioDraft)

/** 構詞文法的寫法（這裡不支援編輯） */
const isGrammar = computed(() => !!draft.profile.morphology && 'morphemes' in draft.profile.morphology)
const spec = computed(() => (isGrammar.value ? null : ((draft.profile.morphology as MorphologySpec | undefined) ?? null)))

async function enable(on: boolean) {
  if (on) draft.profile.morphology = { prefixes: [], suffixes: [], minStem: 3 }
  else if (await askConfirm({ title: t('關掉構詞？'), message: t('關掉構詞會刪掉所有詞綴與構詞音變。要保留，請先匯出專案檔。'), confirm: t('關掉構詞'), destructive: true })) delete draft.profile.morphology
}

type AffixList = 'prefixes' | 'suffixes' | 'infixes'
const LISTS: Array<{ key: AffixList; hint: string }> = [
  { key: 'prefixes', hint: msg('加在詞前面，例如 ma-（寫 ma）') },
  { key: 'suffixes', hint: msg('加在詞後面，例如 -an（寫 an）') },
  { key: 'infixes', hint: msg('插在第一個輔音之後，例如 <in>（寫 in）') },
]
const listOf = (key: AffixList) => spec.value?.[key] ?? []
function addAffix(key: AffixList) {
  const s = spec.value as MorphologySpec
  ;(s[key] ??= []).push({ form: '' })
}
const glossText = (gloss: unknown) => (typeof gloss === 'string' ? gloss : '')
const invalid = (path: string) => issuePaths.value.has(path) || undefined

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
const hasPattern = (p: ReduplicationPattern) => (spec.value?.reduplication ?? []).some((r) => r.pattern === p)
function togglePattern(p: ReduplicationPattern, on: boolean) {
  const s = spec.value as MorphologySpec
  const list = (s.reduplication ?? []).filter((r) => r.pattern !== p)
  s.reduplication = on ? [...list, { pattern: p }] : list
}

type AlternationSpec = NonNullable<MorphologySpec['alternations']>[number]
const POSITIONS: Array<{ value: NonNullable<AlternationSpec['position']>; label: string }> = [
  { value: 'final', label: msg('詞素末') },
  { value: 'initial', label: msg('詞素首') },
  { value: 'any', label: msg('任何位置') },
]
function addAlternation() {
  const s = spec.value as MorphologySpec
  ;(s.alternations ??= []).push({ underlying: '', surface: '', position: 'final' })
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

    <p v-if="isGrammar" class="rounded-lg border border-dashed p-6 text-sm">
      {{ t('這份設定檔的構詞是用「構詞文法」（morphemes、constructions）寫的，請到「進階」分頁編輯 JSON。') }}
    </p>
    <template v-else>
      <label class="flex items-center gap-2 text-sm font-medium">
        <Checkbox :model-value="!!spec" @update:model-value="(v) => enable(v === true)" />
        {{ t('使用構詞（自動拆解詞綴）') }}
      </label>

      <template v-if="spec">
        <section v-for="list in LISTS" :key="list.key" class="max-w-3xl space-y-2">
          <div class="flex items-baseline justify-between gap-2">
            <h2 class="font-semibold">{{ specLabel(list.key) }}</h2>
            <Button variant="ghost" size="sm" @click="addAffix(list.key)"><PlusIcon />{{ t('新增') }}</Button>
          </div>
          <p class="text-muted-foreground text-xs">{{ t(list.hint) }}</p>
          <div v-for="(affix, k) in listOf(list.key)" :key="k" class="flex items-center gap-2" :data-path="`profile.morphology.${list.key}[${k}]`">
            <Input v-model="affix.form" class="native-text h-8 w-32 font-mono" :aria-label="t('寫法')" :aria-invalid="!affix.form.trim() || invalid(`profile.morphology.${list.key}[${k}]`)" />
            <Input class="h-8 flex-1" :model-value="glossText(affix.gloss)" :placeholder="t('意思（選填）')" :aria-label="t('意思')" @update:model-value="(v) => (affix.gloss = String(v) || undefined)" />
            <Button variant="ghost" size="icon" :aria-label="t('刪除')" @click="listOf(list.key).splice(k, 1)"><Trash2Icon /></Button>
          </div>
        </section>

        <section class="max-w-3xl space-y-2">
          <h2 class="font-semibold">{{ specLabel('reduplication') }}</h2>
          <div class="grid gap-2 sm:grid-cols-2">
            <label v-for="p in REDUPLICATION_PATTERNS" :key="p" class="flex items-start gap-2 text-sm">
              <Checkbox class="mt-0.5" :model-value="hasPattern(p)" @update:model-value="(v) => togglePattern(p, v === true)" />
              <span><span class="font-mono">{{ p }}</span> <span class="text-muted-foreground text-xs">{{ t(PATTERN_HINTS[p]) }}</span></span>
            </label>
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
    </template>
  </div>
</template>
