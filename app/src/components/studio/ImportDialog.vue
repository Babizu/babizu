<script setup lang="ts">
/**
 * 匯入詞表或例句：上傳 CSV、TSV、Excel（.xlsx），或從試算表複製貼上 → 指定每一欄是什麼 → 預覽 → 附加或取代。
 * 方言欄的值可以是變體代碼或名稱；對不到的值可以自動新增為語言變體。
 */
import { computed, ref, watch, reactive } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { msg, t } from '@/i18n.ts'
import { site } from '@/lib/labels.ts'
import { draft as studioDraft } from '@/playground/studio.ts'
import { COLUMN_ROLES, guessRoles, parseTable, suggestVarietyCode, tableToSentences, tableToWords, type ColumnRole } from '@babizu/playground/tabular.ts'
import { readXlsx } from '@babizu/playground/xlsx.ts'

/** 草稿（以 reactive 取用：模板裡直接改它的欄位，Vue 才知道它不是 ref） */
const draft = reactive(studioDraft)

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ kind: 'words' | 'sentences' }>()
/** 匯入完成（附加或取代），讓表格翻到新的列 */
const emit = defineEmits<{ imported: [mode: 'append' | 'replace'] }>()

const pasted = ref('')
const table = ref<string[][]>([])
const roles = ref<ColumnRole[]>([])
const hasHeader = ref(true)
const addVarieties = ref(true)
const mode = ref<'append' | 'replace'>('append')
const fileName = ref('')
const error = ref('')

const ROLE_LABELS: Record<ColumnRole, string> = {
  text: msg('詞形／句子'),
  zh: msg('中文'),
  en: msg('英文'),
  dialect: msg('方言'),
  pos: msg('詞類'),
  alt: msg('其他寫法'),
  note: msg('備註'),
  ignore: msg('不用'),
}
/** 例句只用得到這幾種 */
const roleOptions = computed(() => (props.kind === 'words' ? COLUMN_ROLES : COLUMN_ROLES.filter((r) => ['text', 'zh', 'en', 'dialect', 'note', 'ignore'].includes(r))))

watch(open, (value) => {
  if (!value) return
  pasted.value = ''
  table.value = []
  roles.value = []
  fileName.value = ''
  error.value = ''
  mode.value = 'append'
})

function useTable(rows: string[][]) {
  error.value = ''
  table.value = rows
  const width = Math.max(0, ...rows.map((r) => r.length))
  const guessed = guessRoles(rows[0] ?? [])
  hasHeader.value = guessed.some((r) => r !== 'ignore')
  // 沒有表頭時：第一欄當詞形，其他不用（使用者再改）
  roles.value = Array.from({ length: width }, (_, k) => (hasHeader.value ? (guessed[k] ?? 'ignore') : k === 0 ? 'text' : 'ignore'))
  if (!rows.length) error.value = t('表格是空的')
}
function parsePasted() {
  useTable(parseTable(pasted.value))
}
async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  fileName.value = file.name
  try {
    if (/\.xlsx$/iu.test(file.name)) useTable(await readXlsx(new Uint8Array(await file.arrayBuffer())))
    else useTable(parseTable(await file.text()))
  } catch (err) {
    error.value = t('無法讀取這個檔案：{message}', { message: (err as Error).message })
  }
}

const width = computed(() => roles.value.length)
const preview = computed(() => (hasHeader.value ? table.value.slice(1, 6) : table.value.slice(0, 5)))
const result = computed(() => {
  if (!table.value.length) return null
  const opts = { hasHeader: hasHeader.value, varieties: draft.varieties, usedIds: mode.value === 'append' ? draft[props.kind].map((r) => r.id) : [] }
  return props.kind === 'words' ? tableToWords(table.value, roles.value, opts) : tableToSentences(table.value, roles.value, opts)
})
const ready = computed(() => !!result.value && roles.value.includes('text') && result.value.rows.length > 0)

function doImport() {
  const res = result.value
  if (!res || !ready.value) return
  let rows = res.rows
  if (res.unknownDialects.length && addVarieties.value) {
    // 對不到的方言值：新增為變體，再重新對應一次
    for (const label of res.unknownDialects) {
      const code = suggestVarietyCode(label, draft.varieties.map((v) => v.code))
      draft.varieties.push({ code, label: Object.fromEntries(site.locales.map((l) => [l, label])) })
    }
    const opts = { hasHeader: hasHeader.value, varieties: draft.varieties, usedIds: mode.value === 'append' ? draft[props.kind].map((r) => r.id) : [] }
    rows = (props.kind === 'words' ? tableToWords(table.value, roles.value, opts) : tableToSentences(table.value, roles.value, opts)).rows
  }
  if (mode.value === 'replace') draft[props.kind].splice(0, draft[props.kind].length)
  ;(draft[props.kind] as unknown[]).push(...rows)
  toast.success(t('已匯入 {count} 列', { count: rows.length }))
  emit('imported', mode.value)
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{{ kind === 'words' ? t('匯入詞表') : t('匯入例句') }}</DialogTitle>
        <DialogDescription>
          {{ t('上傳 CSV、TSV 或 Excel（.xlsx），或從試算表選取範圍複製、貼在下面。第一列可以是表頭（例如：詞、中文、英文、方言）。') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-3">
        <input type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values" class="text-sm" :aria-label="t('選擇檔案')" @change="onFile" />
        <textarea
          v-model="pasted"
          rows="5"
          class="border-input focus-visible:border-ring focus-visible:ring-ring/50 native-text w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:ring-[3px]"
          :placeholder="t('或貼在這裡…')"
          :aria-label="t('貼上表格')"
        />
        <Button variant="outline" size="sm" :disabled="!pasted.trim()" @click="parsePasted">{{ t('讀取貼上的內容') }}</Button>
        <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
      </div>

      <template v-if="table.length && width">
        <div class="space-y-2">
          <label class="flex items-center gap-2 text-sm">
            <Checkbox :model-value="hasHeader" @update:model-value="(v) => (hasHeader = v === true)" />
            {{ t('第一列是表頭') }}
          </label>
          <p class="text-muted-foreground text-xs">{{ t('每一欄選一種用途；預覽前 5 列。') }}</p>
          <div class="relative overflow-x-auto rounded-lg border">
            <table class="w-full text-xs">
              <thead class="bg-muted/50">
                <tr>
                  <th v-for="(_, c) in roles" :key="c" class="px-2 py-1.5 text-left">
                    <select v-model="roles[c]" class="border-input bg-background h-8 w-full min-w-24 rounded-md border px-1 text-xs" :aria-label="t('第 {n} 欄的用途', { n: c + 1 })">
                      <option v-for="r in roleOptions" :key="r" :value="r">{{ t(ROLE_LABELS[r]) }}</option>
                    </select>
                    <div v-if="hasHeader" class="text-muted-foreground mt-1 truncate font-normal">{{ table[0][c] }}</div>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr v-for="(row, r) in preview" :key="r">
                  <td v-for="(_, c) in roles" :key="c" class="native-text max-w-48 truncate px-2 py-1" :class="roles[c] === 'ignore' && 'text-muted-foreground/60'">{{ row[c] }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-if="result" class="space-y-2 text-sm">
          <p>
            {{ t('會匯入 {count} 列', { count: result.rows.length }) }}<template v-if="result.skipped">{{ t('（{skipped} 列沒有詞形或句子，略過）', { skipped: result.skipped }) }}</template>
          </p>
          <p v-if="!roles.includes('text')" class="text-destructive">{{ t('請指定哪一欄是詞形或句子。') }}</p>
          <div v-if="result.unknownDialects.length" class="space-y-1">
            <p>{{ t('方言欄有這些值對不到語言變體：{values}', { values: result.unknownDialects.join('、') }) }}</p>
            <label class="flex items-center gap-2">
              <Checkbox :model-value="addVarieties" @update:model-value="(v) => (addVarieties = v === true)" />
              {{ t('自動新增為語言變體（之後可以在「專案」分頁改名稱與代碼）') }}
            </label>
          </div>
          <fieldset class="flex flex-wrap gap-4">
            <legend class="sr-only">{{ t('匯入方式') }}</legend>
            <label class="flex items-center gap-2"><input v-model="mode" type="radio" value="append" />{{ t('附加在後面') }}</label>
            <label class="flex items-center gap-2"><input v-model="mode" type="radio" value="replace" />{{ t('取代現有的（{count} 列）', { count: draft[kind].length }) }}</label>
          </fieldset>
        </div>
      </template>

      <DialogFooter>
        <Button variant="ghost" @click="open = false">{{ t('取消') }}</Button>
        <Button :disabled="!ready" @click="doImport">{{ t('匯入') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
