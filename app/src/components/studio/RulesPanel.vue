<script setup lang="ts">
/**
 * 工作台的「方言規則」分頁：規則組（類別、位置、說明）與每組的規則（來源 ↔ 目標、權重、位置、是否雙向），
 * 以及正規化（大小寫、附加符號、字元對照）與基本成本。說明見 babizu 的 docs/language-profile.md。
 */
import { FlaskConicalIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import type { RuleGroup, RulePosition } from '#bcdp'
import { computed, ref, watch, reactive } from 'vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { msg, t } from '@/i18n.ts'
import { draft as studioDraft } from '@/playground/studio.ts'
import { ruleRowFrom, ruleRowProblem, ruleRowView, type RuleRowView } from '@babizu/playground/rule-rows.ts'

/** 草稿（以 reactive 取用：模板裡直接改它的欄位，Vue 才知道它不是 ref） */
const draft = reactive(studioDraft)

const POSITIONS: Array<{ value: RulePosition; label: string }> = [
  { value: 'any', label: msg('任何位置') },
  { value: 'initial', label: msg('詞首') },
  { value: 'final', label: msg('詞尾') },
]

const groups = computed<RuleGroup[]>(() => draft.profile.rules ?? [])

function addGroup() {
  ;(draft.profile.rules ??= []).push({ category: t('新的規則組'), rules: [['', '', 0.1]] })
}
function removeGroup(k: number) {
  if (!groups.value[k].rules.length || window.confirm(t('刪除規則組「{name}」和它的 {count} 條規則？', { name: groups.value[k].category, count: groups.value[k].rules.length }))) groups.value.splice(k, 1)
}
function update(group: RuleGroup, k: number, patch: Partial<RuleRowView>) {
  group.rules[k] = ruleRowFrom({ ...ruleRowView(group.rules[k]), ...patch })
}
const weightOf = (value: string) => (value.trim() === '' ? Number.NaN : Number(value))

/**
 * 正規化的字元對照，編輯成「從 → 到」的列。列表放在這裡（可以有還沒填的空列），
 * 改了才寫回設定檔（略過「從」是空的列）；整份專案換掉時重新讀
 */
const charMap = ref<Array<[string, string]>>([])
watch(
  () => draft.profile.normalizer?.charMap,
  (map) => {
    const current = charMap.value.filter(([from]) => from !== '')
    if (JSON.stringify(Object.fromEntries(current)) !== JSON.stringify(map ?? {})) charMap.value = Object.entries(map ?? {})
  },
  { immediate: true, deep: true },
)
function setCharMap(entries: Array<[string, string]>) {
  charMap.value = entries
  draft.profile.normalizer = { ...(draft.profile.normalizer ?? {}), charMap: Object.fromEntries(entries.filter(([from]) => from !== '')) }
}
function setNormalizer(key: 'lowercase' | 'stripDiacritics', value: boolean) {
  draft.profile.normalizer = { ...(draft.profile.normalizer ?? {}), [key]: value }
}
const COSTS = [
  { key: 'substitute', label: msg('替換'), fallback: 1.5 },
  { key: 'delete', label: msg('刪除'), fallback: 1 },
  { key: 'insert', label: msg('插入'), fallback: 0.8 },
] as const
function setCost(key: 'substitute' | 'delete' | 'insert', value: string) {
  const costs = { ...(draft.profile.costs ?? {}) }
  if (value.trim() === '') delete costs[key]
  else costs[key] = Number(value)
  draft.profile.costs = costs
}
</script>

<template>
  <div class="space-y-10">
    <section class="space-y-4">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-lg font-semibold">{{ t('方言之間的語音對應') }}</h2>
        <div class="flex gap-2">
          <Button variant="ghost" size="sm" as-child>
            <RouterLink :to="{ name: 'lab' }"><FlaskConicalIcon />{{ t('在實驗室試試') }}</RouterLink>
          </Button>
          <Button variant="outline" size="sm" @click="addGroup"><PlusIcon />{{ t('新增規則組') }}</Button>
        </div>
      </div>
      <p class="text-muted-foreground max-w-3xl text-sm leading-relaxed">
        {{ t('每條規則說「一個方言的這個寫法，在另一個方言是那個寫法」，例如 r ↔ l。權重越小越便宜：有系統的對應寫 0.1，偶爾才有的 0.2–0.3；一般的打錯是 1 左右。規則預設雙向。目標留空表示「脫落」。實驗室用的是最後一次建置的規則；改好之後按「建置」。') }}
      </p>
      <p v-if="!groups.length" class="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">{{ t('還沒有規則。沒有規則也能建置，模糊搜尋只靠一般的編輯距離。') }}</p>

      <div v-for="(group, g) in groups" :key="g" class="space-y-3 rounded-xl border p-4">
        <div class="grid gap-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
          <label class="space-y-1 text-sm">
            <span class="text-muted-foreground text-xs">{{ t('類別') }}</span>
            <Input v-model="group.category" class="h-9" />
          </label>
          <label class="space-y-1 text-sm">
            <span class="text-muted-foreground text-xs">{{ t('說明') }}</span>
            <Input :model-value="group.description ?? ''" class="h-9" @update:model-value="(v) => (group.description = String(v) || undefined)" />
          </label>
          <label class="space-y-1 text-sm">
            <span class="text-muted-foreground text-xs">{{ t('整組的位置') }}</span>
            <select
              class="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              :value="group.position ?? 'any'"
              @change="(e) => (group.position = ((e.target as HTMLSelectElement).value as RulePosition) === 'any' ? undefined : ((e.target as HTMLSelectElement).value as RulePosition))"
            >
              <option v-for="p in POSITIONS" :key="p.value" :value="p.value">{{ t(p.label) }}</option>
            </select>
          </label>
          <Button variant="ghost" size="icon" :aria-label="t('刪除規則組')" @click="removeGroup(g)"><Trash2Icon /></Button>
        </div>
        <div class="relative overflow-x-auto">
          <table class="w-full min-w-[34rem] text-sm">
            <thead class="text-muted-foreground text-left text-xs">
              <tr>
                <th class="px-1 py-1 font-medium">{{ t('寫法 A') }}</th>
                <th class="w-6" aria-hidden="true" />
                <th class="px-1 py-1 font-medium">{{ t('寫法 B') }}</th>
                <th class="px-1 py-1 font-medium">{{ t('權重') }}</th>
                <th class="px-1 py-1 font-medium">{{ t('位置') }}</th>
                <th class="px-1 py-1 font-medium">{{ t('雙向') }}</th>
                <th class="w-10"><span class="sr-only">{{ t('刪除') }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, k) in group.rules.map(ruleRowView)" :key="k">
                <td class="px-1 py-1">
                  <Input class="native-text h-8 font-mono" :model-value="row.source" :aria-label="t('寫法 A')" :aria-invalid="ruleRowProblem(row) === 'empty' || undefined" @update:model-value="(v) => update(group, k, { source: String(v) })" />
                </td>
                <td class="text-muted-foreground text-center" aria-hidden="true">{{ row.bidirectional === false ? '→' : '↔' }}</td>
                <td class="px-1 py-1">
                  <Input class="native-text h-8 font-mono" :model-value="row.target" :placeholder="t('（脫落）')" :aria-label="t('寫法 B')" :aria-invalid="ruleRowProblem(row) === 'empty' || undefined" @update:model-value="(v) => update(group, k, { target: String(v) })" />
                </td>
                <td class="px-1 py-1">
                  <Input
                    type="number"
                    min="0"
                    step="0.05"
                    class="h-8 w-20 tabular-nums"
                    :model-value="Number.isFinite(row.weight) ? row.weight : ''"
                    :aria-label="t('權重')"
                    :aria-invalid="ruleRowProblem(row) === 'weight' || undefined"
                    @update:model-value="(v) => update(group, k, { weight: weightOf(String(v)) })"
                  />
                </td>
                <td class="px-1 py-1">
                  <select
                    class="border-input bg-background h-8 rounded-md border px-1 text-sm"
                    :value="row.position ?? ''"
                    :aria-label="t('位置')"
                    @change="(e) => update(group, k, { position: ((e.target as HTMLSelectElement).value || undefined) as RulePosition | undefined })"
                  >
                    <option value="">{{ t('同整組') }}</option>
                    <option v-for="p in POSITIONS" :key="p.value" :value="p.value">{{ t(p.label) }}</option>
                  </select>
                </td>
                <td class="px-1 py-1">
                  <Checkbox :model-value="row.bidirectional !== false" :aria-label="t('雙向')" @update:model-value="(v) => update(group, k, { bidirectional: v === true ? undefined : false })" />
                </td>
                <td class="px-1 py-1">
                  <Button variant="ghost" size="icon" :aria-label="t('刪除')" @click="group.rules.splice(k, 1)"><Trash2Icon /></Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Button variant="ghost" size="sm" @click="group.rules.push(['', '', 0.1])"><PlusIcon />{{ t('新增規則') }}</Button>
      </div>
    </section>

    <section class="max-w-3xl space-y-4">
      <h2 class="text-lg font-semibold">{{ t('正規化') }}</h2>
      <p class="text-muted-foreground text-sm">{{ t('建索引與搜尋之前，先把寫法統一：例如大小寫、附加符號，或把不同的撇號寫成同一個。') }}</p>
      <div class="flex flex-wrap gap-6 text-sm">
        <label class="flex items-center gap-2">
          <Checkbox :model-value="draft.profile.normalizer?.lowercase ?? true" @update:model-value="(v) => setNormalizer('lowercase', v === true)" />
          {{ t('不分大小寫') }}
        </label>
        <label class="flex items-center gap-2">
          <Checkbox :model-value="draft.profile.normalizer?.stripDiacritics ?? false" @update:model-value="(v) => setNormalizer('stripDiacritics', v === true)" />
          {{ t('忽略附加符號（é ＝ e）') }}
        </label>
      </div>
      <div class="space-y-2">
        <p class="text-sm font-medium">{{ t('字元對照') }}</p>
        <div v-for="([from, to], k) in charMap" :key="k" class="flex items-center gap-2">
          <Input class="native-text h-8 w-24 font-mono" :model-value="from" :aria-label="t('從')" @change="(e: Event) => setCharMap(charMap.map(([f, x], i) => (i === k ? [(e.target as HTMLInputElement).value, x] : [f, x])))" />
          <span class="text-muted-foreground" aria-hidden="true">→</span>
          <Input class="native-text h-8 w-24 font-mono" :model-value="to" :aria-label="t('到')" @change="(e: Event) => setCharMap(charMap.map(([f, x], i) => (i === k ? [f, (e.target as HTMLInputElement).value] : [f, x])))" />
          <Button variant="ghost" size="icon" :aria-label="t('刪除')" @click="setCharMap(charMap.filter((_, i) => i !== k))"><Trash2Icon /></Button>
        </div>
        <Button variant="ghost" size="sm" @click="charMap.push(['', ''])"><PlusIcon />{{ t('新增字元對照') }}</Button>
      </div>
    </section>

    <section class="max-w-3xl space-y-3">
      <h2 class="text-lg font-semibold">{{ t('基本成本') }}</h2>
      <p class="text-muted-foreground text-sm">{{ t('沒有規則可以解釋的差異，每改一個字元的成本。') }}</p>
      <div class="flex flex-wrap gap-4">
        <label v-for="c in COSTS" :key="c.key" class="space-y-1 text-sm">
          <span class="text-muted-foreground text-xs">{{ t(c.label) }}</span>
          <Input type="number" min="0" step="0.1" class="h-9 w-24 tabular-nums" :model-value="draft.profile.costs?.[c.key] ?? c.fallback" @update:model-value="(v) => setCost(c.key, String(v))" />
        </label>
      </div>
    </section>
  </div>
</template>
