<script setup lang="ts">
/**
 * 工作台的「詞表」分頁：詞與例句兩張可以直接編輯的表格（新增、刪除、篩選、分頁），以及匯入（ImportDialog）。
 * 方言欄是每個語言變體一個切換鈕；其他寫法以逗號分開。
 */
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, Trash2Icon, UploadIcon } from '@lucide/vue'
import { computed, ref, watch, reactive } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n.ts'
import { site } from '@/lib/labels.ts'
import { textOf } from '@/playground/localized.ts'
import { draft as studioDraft } from '@/playground/studio.ts'
import { nextId } from '@babizu/playground/project.ts'
import ImportDialog from './ImportDialog.vue'

/** 草稿（以 reactive 取用：模板裡直接改它的欄位，Vue 才知道它不是 ref） */
const draft = reactive(studioDraft)

const PAGE = 50
const kind = ref<'words' | 'sentences'>('words')
const filter = ref('')
const page = ref(0)
const importing = ref(false)

/** 符合篩選的列（保留原本的索引，編輯直接改 draft） */
const matches = computed(() => {
  const rows = draft[kind.value]
  const q = filter.value.trim().toLowerCase()
  const out: number[] = []
  rows.forEach((r, k) => {
    if (!q || [r.text, r.zh, r.en].some((x) => x.toLowerCase().includes(q))) out.push(k)
  })
  return out
})
const pages = computed(() => Math.max(1, Math.ceil(matches.value.length / PAGE)))
const visible = computed(() => matches.value.slice(page.value * PAGE, (page.value + 1) * PAGE))
watch([kind, filter], () => (page.value = 0))
watch(pages, (n) => {
  if (page.value >= n) page.value = n - 1
})

const varietyName = (code: string) => textOf(draft.varieties.find((v) => v.code === code)?.label, site.defaultLocale) || code

function toggleDialect(row: { dialects: string[] }, code: string) {
  row.dialects = row.dialects.includes(code) ? row.dialects.filter((d) => d !== code) : [...row.dialects, code]
}
function addRow() {
  filter.value = ''
  if (kind.value === 'words') {
    const id = nextId('w', draft.words.map((w) => w.id))()
    draft.words.push({ id, text: '', zh: '', en: '', dialects: [], pos: '', alt: [], note: '' })
  } else {
    const id = nextId('s', draft.sentences.map((s) => s.id))()
    draft.sentences.push({ id, text: '', zh: '', en: '', dialects: [] })
  }
  page.value = pages.value - 1
}
function removeRow(k: number) {
  draft[kind.value].splice(k, 1)
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <div class="bg-muted inline-flex rounded-lg p-1" role="group" :aria-label="t('表格')">
        <button
          v-for="k in ['words', 'sentences'] as const"
          :key="k"
          type="button"
          class="h-8 rounded-md px-3 text-sm"
          :class="kind === k ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'"
          :aria-pressed="kind === k"
          @click="kind = k"
        >
          {{ k === 'words' ? t('詞（{count}）', { count: draft.words.length }) : t('例句（{count}）', { count: draft.sentences.length }) }}
        </button>
      </div>
      <Input v-model="filter" class="h-9 w-48" :placeholder="t('篩選')" :aria-label="t('篩選')" />
      <div class="ml-auto flex gap-2">
        <Button variant="outline" size="sm" @click="importing = true"><UploadIcon />{{ t('匯入') }}</Button>
        <Button variant="outline" size="sm" @click="addRow"><PlusIcon />{{ kind === 'words' ? t('新增一個詞') : t('新增一個例句') }}</Button>
      </div>
    </div>

    <p v-if="!draft[kind].length" class="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
      {{ t('還沒有資料。按「匯入」貼上或上傳一份表格（CSV、TSV、Excel），或按「新增」一列一列輸入。') }}
    </p>
    <div v-else class="relative overflow-x-auto rounded-lg border">
      <table class="w-full text-sm" :class="kind === 'words' ? 'min-w-[60rem]' : 'min-w-[44rem]'">
        <thead class="bg-muted/50 text-muted-foreground text-left text-xs">
          <tr>
            <th class="px-2 py-2 font-medium">{{ kind === 'words' ? t('詞形') : t('句子') }}</th>
            <th class="px-2 py-2 font-medium">{{ t('中文') }}</th>
            <th class="px-2 py-2 font-medium">{{ t('英文') }}</th>
            <th class="px-2 py-2 font-medium">{{ t('方言') }}</th>
            <template v-if="kind === 'words'">
              <th class="px-2 py-2 font-medium">{{ t('詞類') }}</th>
              <th class="px-2 py-2 font-medium">{{ t('其他寫法') }}</th>
              <th class="px-2 py-2 font-medium">{{ t('備註') }}</th>
            </template>
            <th class="w-10"><span class="sr-only">{{ t('刪除') }}</span></th>
          </tr>
        </thead>
        <tbody class="divide-y">
          <tr v-for="k in visible" :key="draft[kind][k].id">
            <td class="px-1.5 py-1"><Input v-model="draft[kind][k].text" class="native-text h-8" :aria-label="kind === 'words' ? t('詞形') : t('句子')" :aria-invalid="!draft[kind][k].text.trim() || undefined" /></td>
            <td class="px-1.5 py-1"><Input v-model="draft[kind][k].zh" class="h-8" :aria-label="t('中文')" /></td>
            <td class="px-1.5 py-1"><Input v-model="draft[kind][k].en" class="h-8" :aria-label="t('英文')" /></td>
            <td class="px-1.5 py-1">
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="v in draft.varieties"
                  :key="v.code"
                  type="button"
                  class="h-7 rounded-md border px-2 text-xs"
                  :class="draft[kind][k].dialects.includes(v.code) ? `variety-${v.code} border-transparent bg-(--variety-bg) text-(--variety-fg)` : 'text-muted-foreground'"
                  :aria-pressed="draft[kind][k].dialects.includes(v.code)"
                  @click="toggleDialect(draft[kind][k], v.code)"
                >
                  {{ varietyName(v.code) }}
                </button>
                <span v-for="d in draft[kind][k].dialects.filter((d) => !draft.varieties.some((v) => v.code === d))" :key="d" class="text-destructive text-xs">{{ d }}?</span>
              </div>
            </td>
            <template v-if="kind === 'words'">
              <td class="px-1.5 py-1"><Input v-model="draft.words[k].pos" class="h-8 w-20" :aria-label="t('詞類')" /></td>
              <td class="px-1.5 py-1">
                <Input
                  class="h-8"
                  :model-value="draft.words[k].alt.join(', ')"
                  :aria-label="t('其他寫法')"
                  @change="(e: Event) => (draft.words[k].alt = (e.target as HTMLInputElement).value.split(/[,，;；]/u).map((s) => s.trim()).filter(Boolean))"
                />
              </td>
              <td class="px-1.5 py-1"><Input v-model="draft.words[k].note" class="h-8" :aria-label="t('備註')" /></td>
            </template>
            <td class="px-1 py-1">
              <Button variant="ghost" size="icon" :aria-label="t('刪除')" @click="removeRow(k)"><Trash2Icon /></Button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="pages > 1" class="flex items-center justify-center gap-3 text-sm">
      <Button variant="ghost" size="icon" :disabled="page === 0" :aria-label="t('上一頁')" @click="page--"><ChevronLeftIcon /></Button>
      <span class="tabular-nums">{{ t('第 {page}／{pages} 頁', { page: page + 1, pages }) }}</span>
      <Button variant="ghost" size="icon" :disabled="page >= pages - 1" :aria-label="t('下一頁')" @click="page++"><ChevronRightIcon /></Button>
    </div>
    <ImportDialog v-model:open="importing" :kind="kind" />
  </div>
</template>
