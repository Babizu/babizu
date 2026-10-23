<script setup lang="ts">
/**
 * 工作台的「專案」分頁：辭典名稱與說明、語言變體（方言）。
 * 專案的切換、新增、匯入、匯出在工作台頂端的專案列（ProjectBar.vue）。
 */
import { PlusIcon, Trash2Icon } from '@lucide/vue'
import { reactive } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n.ts'
import { site } from '@/lib/labels.ts'
import { askConfirm } from '@/playground/confirm.ts'
import { textOf, withText } from '@/playground/localized.ts'
import { issuePaths, draft as studioDraft } from '@/playground/studio.ts'
import { suggestVarietyCode } from '@babizu/playground/tabular.ts'

/** 草稿（以 reactive 取用：模板裡直接改它的欄位，Vue 才知道它不是 ref） */
const draft = reactive(studioDraft)

const locales = site.locales

function addVariety() {
  const code = suggestVarietyCode('', draft.varieties.map((v) => v.code))
  draft.varieties.push({ code, label: Object.fromEntries(locales.map((l) => [l, code])) })
}
async function removeVariety(k: number) {
  const code = draft.varieties[k].code
  const used = [...draft.words, ...draft.sentences].filter((row) => row.dialects.includes(code)).length
  const children = draft.varieties.filter((v) => v.parent === code).length
  if (used || children) {
    const ok = await askConfirm({
      title: t('刪除語言變體「{name}」？', { name: textOf(draft.varieties[k].label, site.defaultLocale) || code }),
      message: t('{count} 個詞或例句標了這個變體，{children} 個變體以它為上層。刪除之後，這些標記和上層設定也會一併拿掉。', { count: used, children }),
      confirm: t('刪除'),
      destructive: true,
    })
    if (!ok) return
  }
  draft.varieties.splice(k, 1)
  // 用到它的詞、例句、下層變體一併拿掉這個代碼
  for (const row of [...draft.words, ...draft.sentences]) row.dialects = row.dialects.filter((d) => d !== code)
  for (const v of draft.varieties) if (v.parent === code) v.parent = null
}
function renameVariety(k: number, code: string) {
  const old = draft.varieties[k].code
  if (code === old) return
  draft.varieties[k].code = code
  for (const row of [...draft.words, ...draft.sentences]) row.dialects = row.dialects.map((d) => (d === old ? code : d))
  for (const v of draft.varieties) if (v.parent === old) v.parent = code
}
const invalid = (path: string) => issuePaths.value.has(path) || undefined
</script>

<template>
  <div class="space-y-10">
    <section class="max-w-3xl space-y-4" data-path="title">
      <h2 class="text-lg font-semibold">{{ t('辭典') }}</h2>
      <div v-for="locale in locales" :key="locale" class="grid gap-3 sm:grid-cols-[8rem_1fr] sm:items-center">
        <label :for="`title-${locale}`" class="text-sm font-medium">{{ t('名稱（{language}）', { language: site.localeNames[locale] }) }}</label>
        <Input :id="`title-${locale}`" :aria-invalid="invalid('title')" :model-value="textOf(draft.title, locale)" @update:model-value="(v) => (draft.title = withText(draft.title, locale, String(v), locales))" />
        <label :for="`description-${locale}`" class="text-sm font-medium sm:self-start sm:pt-2">{{ t('說明（{language}）', { language: site.localeNames[locale] }) }}</label>
        <textarea
          :id="`description-${locale}`"
          rows="2"
          class="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
          :value="textOf(draft.description, locale)"
          @input="(e) => (draft.description = withText(draft.description, locale, (e.target as HTMLTextAreaElement).value, locales))"
        />
      </div>
    </section>

    <section class="space-y-3">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-lg font-semibold">{{ t('語言變體') }}</h2>
        <Button variant="outline" size="sm" @click="addVariety"><PlusIcon />{{ t('新增變體') }}</Button>
      </div>
      <p class="text-muted-foreground max-w-3xl text-sm">
        {{ t('代碼用小寫英數（例如 north），每個方言或變體可以設定其上層方言，搜尋時選擇上層方言則底下的方言或變體都會出現。') }}
      </p>
      <p v-if="!draft.varieties.length" class="text-muted-foreground text-sm">{{ t('還沒有語言變體。沒有變體也可以建置，只是不能依方言篩選。') }}</p>
      <div v-else class="relative overflow-x-auto rounded-lg border">
        <table class="w-full min-w-[36rem] text-sm">
          <thead class="bg-muted/50 text-muted-foreground text-left text-xs">
            <tr>
              <th class="px-3 py-2 font-medium">{{ t('代碼') }}</th>
              <th v-for="locale in locales" :key="locale" class="px-3 py-2 font-medium">{{ t('名稱（{language}）', { language: site.localeNames[locale] }) }}</th>
              <th class="px-3 py-2 font-medium">{{ t('上層') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('色相') }}</th>
              <th class="w-10"><span class="sr-only">{{ t('刪除') }}</span></th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr v-for="(v, k) in draft.varieties" :key="k" :data-path="`varieties[${k}]`">
              <td class="px-2 py-1.5">
                <Input class="h-8 w-28 font-mono" :model-value="v.code" :aria-label="t('代碼')" :aria-invalid="invalid(`varieties[${k}].code`)" @change="(e: Event) => renameVariety(k, (e.target as HTMLInputElement).value.trim())" />
              </td>
              <td v-for="locale in locales" :key="locale" class="px-2 py-1.5">
                <Input class="h-8" :model-value="textOf(v.label, locale)" :aria-invalid="invalid(`varieties[${k}].label`)" :aria-label="t('名稱（{language}）', { language: site.localeNames[locale] })" @update:model-value="(x) => (v.label = withText(v.label, locale, String(x), locales))" />
              </td>
              <td class="px-2 py-1.5">
                <select v-model="v.parent" class="border-input bg-background aria-invalid:border-destructive h-8 w-full rounded-md border px-2 text-sm" :aria-label="t('上層')" :aria-invalid="invalid(`varieties[${k}].parent`)">
                  <option :value="null">—</option>
                  <option v-for="p in draft.varieties.filter((x) => x.code !== v.code)" :key="p.code" :value="p.code">{{ textOf(p.label, site.defaultLocale) || p.code }}</option>
                </select>
              </td>
              <td class="px-2 py-1.5">
                <div class="flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max="359"
                    class="w-24"
                    :value="v.hue ?? ''"
                    :aria-label="t('色相')"
                    @input="(e) => (v.hue = Number((e.target as HTMLInputElement).value))"
                  />
                  <span class="size-4 rounded-full border" :style="{ background: v.hue === undefined ? 'transparent' : `oklch(0.6 0.12 ${v.hue})` }" aria-hidden="true" />
                </div>
              </td>
              <td class="px-1 py-1.5">
                <Button variant="ghost" size="icon" :aria-label="t('刪除')" @click="removeVariety(k)"><Trash2Icon /></Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
