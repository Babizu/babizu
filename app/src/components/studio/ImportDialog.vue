<script setup lang="ts">
/**
 * 匯入詞表或例句：上傳 CSV 檔，或從試算表複製貼上 → 每一欄對到一個欄位 → 預覽 → 附加或取代。
 *
 * - 剖析、編碼、換行、欄首對應的規則在 @babizu/playground/tabular.ts；
 * - 改過的欄首對應記在瀏覽器裡（IndexedDB 的 'import-roles'），下次遇到同名的欄首直接套用；
 * - 方言欄的值可以是變體代碼或名稱；對不到的值可以自動新增為語言變體；
 * - 附加時可以略過與現有資料完全相同的列（避免同一份檔匯入兩次）。
 */
import { FileUpIcon } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { msg, t } from '@/i18n.ts'
import { site } from '@/lib/labels.ts'
import { DB } from '@/playground/builder.ts'
import { askConfirm } from '@/playground/confirm.ts'
import { kvGet, kvSet } from '@/playground/db.ts'
import { draft as studioDraft } from '@/playground/studio.ts'
import {
  COLUMN_ROLES,
  decodeText,
  guessRoles,
  parseTable,
  rolesToRemember,
  suggestVarietyCode,
  tableToSentences,
  tableToWords,
  TableError,
  type ColumnRole,
  type ImportOptions,
} from '@babizu/playground/tabular.ts'

/** 草稿（以 reactive 取用：模板裡直接改它的欄位，Vue 才知道它不是 ref） */
const draft = reactive(studioDraft)

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ kind: 'words' | 'sentences' }>()
/** 匯入完成（附加或取代），讓表格翻到新的列 */
const emit = defineEmits<{ imported: [mode: 'append' | 'replace'] }>()

const REMEMBER_KEY = 'import-roles'

const fileInput = ref<HTMLInputElement | null>(null)
const pasted = ref('')
const table = ref<string[][]>([])
const roles = ref<ColumnRole[]>([])
/** 自動猜的對應（判斷使用者改了哪些） */
const guessed = ref<ColumnRole[]>([])
const remembered = ref<Record<string, ColumnRole>>({})
const hasHeader = ref(true)
const addVarieties = ref(true)
const skipDuplicates = ref(true)
const mode = ref<'append' | 'replace'>('append')
const fileName = ref('')
const encodingNote = ref('')
const error = ref('')

const ROLE_LABELS: Record<ColumnRole, string> = {
  text: msg('詞形／句子'),
  root: msg('詞根'),
  zh: msg('中文'),
  en: msg('英文'),
  dialect: msg('方言'),
  pos: msg('詞類'),
  alt: msg('其他寫法'),
  note: msg('備註'),
  ignore: msg('不匯入'),
}
/** 例句只用得到這幾種 */
const roleOptions = computed(() => (props.kind === 'words' ? COLUMN_ROLES : COLUMN_ROLES.filter((r) => ['text', 'zh', 'en', 'dialect', 'note', 'ignore'].includes(r))))

watch(open, async (value) => {
  if (!value) return
  pasted.value = ''
  table.value = []
  roles.value = []
  fileName.value = ''
  encodingNote.value = ''
  error.value = ''
  mode.value = 'append'
  try {
    remembered.value = (await kvGet<Record<string, ColumnRole>>(DB, REMEMBER_KEY)) ?? {}
  } catch {
    remembered.value = {}
  }
})

/** 欄數：最寬的那一列 */
const width = computed(() => Math.max(0, ...table.value.map((r) => r.length)))
/** 欄的名稱：有表頭時是表頭，否則「第 n 欄」 */
const columnName = (c: number) => (hasHeader.value && table.value[0]?.[c]) || t('第 {n} 欄', { n: c + 1 })
/** 欄的範例值（表頭以下前 3 個非空的值） */
const samples = (c: number) =>
  (hasHeader.value ? table.value.slice(1) : table.value)
    .map((r) => r[c] ?? '')
    .filter(Boolean)
    .slice(0, 3)

function guess() {
  const header = table.value[0] ?? []
  const body = table.value.slice(1, 30)
  const auto = guessRoles(header, body, remembered.value)
  hasHeader.value = auto.some((r) => r !== 'ignore')
  // 沒有表頭時：第一欄當詞形，其他不匯入（使用者再改）
  guessed.value = Array.from({ length: width.value }, (_, k) => (hasHeader.value ? (auto[k] ?? 'ignore') : k === 0 ? 'text' : 'ignore'))
  roles.value = [...guessed.value]
}

function useText(text: string) {
  error.value = ''
  table.value = []
  try {
    table.value = parseTable(text)
  } catch (err) {
    error.value = err instanceof TableError ? t('讀不懂這份表格。{message}', { message: err.message }) : t('讀不懂這份表格：{message}', { message: (err as Error).message })
    return
  }
  if (!table.value.length) {
    error.value = t('表格是空的（沒有任何有內容的列）。')
    return
  }
  guess()
}
function parsePasted() {
  fileName.value = ''
  encodingNote.value = ''
  useText(pasted.value)
}
async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  fileName.value = file.name
  encodingNote.value = ''
  try {
    const { text, encoding } = decodeText(new Uint8Array(await file.arrayBuffer()))
    if (encoding === 'big5') encodingNote.value = t('這個檔案是 Big5 編碼（中文版 Excel 的預設），已自動轉換。')
    else if (encoding !== 'utf-8') encodingNote.value = t('這個檔案是 UTF-16 編碼，已自動轉換。')
    useText(text)
  } catch (err) {
    table.value = []
    error.value = err instanceof TableError ? err.message : t('無法讀取「{name}」：{message}', { name: file.name, message: (err as Error).message })
  }
}

/** 同一種用途指定給兩欄以上：中英文、備註會接起來，其他只用第一欄 */
const doubled = computed(() => {
  const counts = new Map<ColumnRole, number>()
  for (const r of roles.value) if (r !== 'ignore') counts.set(r, (counts.get(r) ?? 0) + 1)
  return [...counts].filter(([, n]) => n > 1).map(([r]) => r)
})

const options = computed<ImportOptions>(() => ({
  hasHeader: hasHeader.value,
  varieties: draft.varieties,
  usedIds: mode.value === 'append' ? draft[props.kind].map((r) => r.id) : [],
  existing: mode.value === 'append' ? draft[props.kind] : [],
  skipDuplicates: skipDuplicates.value,
}))
const convert = (opts: ImportOptions) => (props.kind === 'words' ? tableToWords(table.value, roles.value, opts) : tableToSentences(table.value, roles.value, opts))
const result = computed(() => (table.value.length ? convert(options.value) : null))
const ready = computed(() => !!result.value && roles.value.includes('text') && result.value.rows.length > 0)

/** 預覽：轉換之後的前 5 列 */
const PREVIEW_FIELDS = computed(() => (props.kind === 'words' ? (['text', 'root', 'zh', 'en', 'dialect', 'pos', 'alt', 'note'] as const) : (['text', 'zh', 'en', 'dialect', 'note'] as const)).filter((f) => roles.value.includes(f)))
const varietyName = (code: string) => {
  const v = draft.varieties.find((x) => x.code === code)
  return (typeof v?.label === 'string' ? v.label : v?.label[site.defaultLocale]) || code
}
function previewCell(row: Record<string, unknown>, field: string): string {
  if (field === 'dialect') return (row.dialects as string[]).map(varietyName).join('、')
  if (field === 'alt') return (row.alt as string[]).join(', ')
  return String(row[field] ?? '')
}

async function doImport() {
  const res = result.value
  if (!res || !ready.value) return
  const existing = draft[props.kind].length
  if (mode.value === 'replace' && existing) {
    const ok = await askConfirm({
      title: props.kind === 'words' ? t('取代整個詞表？') : t('取代所有例句？'),
      message: t('現有的 {count} 列會被刪除，換成這次匯入的 {rows} 列。還沒建置之前可以按「放棄變更」復原。', { count: existing, rows: res.rows.length }),
      confirm: t('取代'),
      destructive: true,
    })
    if (!ok) return
  }
  let rows = res.rows
  const added: string[] = []
  if (res.unknownDialects.length && addVarieties.value) {
    // 對不到的方言值：新增為變體，再重新對應一次
    for (const label of res.unknownDialects) {
      const code = suggestVarietyCode(label, draft.varieties.map((v) => v.code))
      draft.varieties.push({ code, label: Object.fromEntries(site.locales.map((l) => [l, label])) })
      added.push(label)
    }
    rows = convert(options.value).rows
  }
  if (mode.value === 'replace') draft[props.kind].splice(0, draft[props.kind].length)
  ;(draft[props.kind] as unknown[]).push(...rows)
  // 記住改過的欄首對應
  if (hasHeader.value) {
    const next = rolesToRemember(table.value[0] ?? [], roles.value, guessed.value, remembered.value)
    if (JSON.stringify(next) !== JSON.stringify(remembered.value)) kvSet(DB, REMEMBER_KEY, next).catch(() => {})
  }
  toast.success(t('已匯入 {count} 列', { count: rows.length }), {
    description: added.length ? t('新增了語言變體：{names}（可以在「專案」分頁改名稱與代碼）', { names: added.join('、') }) : undefined,
  })
  emit('imported', mode.value)
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{{ kind === 'words' ? t('匯入詞表') : t('匯入例句') }}</DialogTitle>
        <DialogDescription class="leading-relaxed">
          {{ t('上傳 CSV 檔，或在試算表選取範圍、複製、貼在下面。Excel 檔請先「另存新檔」，格式選「CSV UTF-8（逗號分隔）」。第一列可以是欄首（例如：詞、中文、英文、方言），之後可以自己指定每一欄對到哪個欄位。') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-3">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <Button variant="outline" size="sm" @click="fileInput?.click()"><FileUpIcon />{{ t('選擇 CSV 檔') }}</Button>
          <span class="text-muted-foreground min-w-0 truncate">{{ fileName || t('還沒有選擇檔案') }}</span>
          <input ref="fileInput" type="file" accept=".csv,text/csv,.tsv,.txt,text/plain" class="hidden" :aria-label="t('選擇 CSV 檔')" @change="onFile" />
        </div>
        <div class="space-y-1">
          <label for="import-paste" class="text-sm font-medium">{{ t('或貼上表格') }}</label>
          <textarea
            id="import-paste"
            v-model="pasted"
            rows="4"
            class="border-input focus-visible:border-ring focus-visible:ring-ring/50 native-text w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:ring-[3px]"
            :placeholder="t('從試算表複製貼上，或貼上 CSV 文字…')"
            :aria-label="t('貼上表格')"
          />
          <Button variant="outline" size="sm" :disabled="!pasted.trim()" @click="parsePasted">{{ t('讀取貼上的內容') }}</Button>
        </div>
        <p v-if="error" role="alert" class="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-2 text-sm">{{ error }}</p>
        <p v-if="encodingNote" class="text-muted-foreground text-xs">{{ encodingNote }}</p>
      </div>

      <template v-if="table.length && width">
        <section class="space-y-2">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="text-sm font-semibold">{{ t('欄位對應') }}</h3>
            <label class="flex items-center gap-2 text-sm">
              <Checkbox :model-value="hasHeader" @update:model-value="(v) => (hasHeader = v === true)" />
              {{ t('第一列是欄首') }}
            </label>
          </div>
          <p class="text-muted-foreground text-xs">
            {{ t('{file}共 {rows} 列、{cols} 欄。替每一欄選擇要匯入成哪個欄位；改過的對應會記在這個瀏覽器裡，下次遇到同名的欄首自動套用。', { file: fileName ? `${fileName}：` : '', rows: hasHeader ? table.length - 1 : table.length, cols: width }) }}
          </p>
          <div class="relative overflow-x-auto rounded-lg border">
            <table class="w-full text-sm">
              <thead class="bg-muted/50 text-muted-foreground text-left text-xs">
                <tr>
                  <th class="px-3 py-2 font-medium">{{ hasHeader ? t('檔案的欄首') : t('欄') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('內容舉例') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('匯入成') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr v-for="c in width" :key="c">
                  <td class="native-text max-w-40 truncate px-3 py-1.5 font-medium">{{ columnName(c - 1) }}</td>
                  <td class="native-text text-muted-foreground max-w-56 truncate px-3 py-1.5 text-xs">{{ samples(c - 1).join(' · ') }}</td>
                  <td class="px-3 py-1.5">
                    <select
                      v-model="roles[c - 1]"
                      class="border-input bg-background h-8 w-full min-w-32 rounded-md border px-2 text-sm"
                      :class="roles[c - 1] === 'ignore' && 'text-muted-foreground'"
                      :aria-label="t('「{name}」匯入成', { name: columnName(c - 1) })"
                    >
                      <option v-for="r in roleOptions" :key="r" :value="r">{{ t(ROLE_LABELS[r]) }}</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!roles.includes('text')" role="alert" class="text-destructive text-sm">{{ kind === 'words' ? t('請指定哪一欄是詞形。') : t('請指定哪一欄是句子。') }}</p>
          <p v-if="doubled.length" class="text-muted-foreground text-xs">
            {{ t('有幾欄對到同一個欄位（{fields}）：中文、英文、備註會依序接起來，其他欄位只取第一欄。', { fields: doubled.map((r) => t(ROLE_LABELS[r])).join('、') }) }}
          </p>
        </section>

        <section v-if="result && roles.includes('text')" class="space-y-2">
          <h3 class="text-sm font-semibold">{{ t('預覽（前 5 列）') }}</h3>
          <div class="relative overflow-x-auto rounded-lg border">
            <table class="w-full text-xs">
              <thead class="bg-muted/50 text-muted-foreground text-left">
                <tr>
                  <th v-for="f in PREVIEW_FIELDS" :key="f" class="px-2 py-1.5 font-medium">{{ t(ROLE_LABELS[f]) }}</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr v-for="(row, r) in result.rows.slice(0, 5)" :key="r">
                  <td v-for="f in PREVIEW_FIELDS" :key="f" class="native-text max-w-48 truncate px-2 py-1">{{ previewCell(row as unknown as Record<string, unknown>, f) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="result" class="space-y-2 text-sm">
          <p class="font-medium">{{ t('會匯入 {count} 列', { count: result.rows.length }) }}</p>
          <ul class="text-muted-foreground list-disc space-y-0.5 pl-5 text-xs">
            <li v-if="result.skippedRows.length">
              {{ t('{count} 列沒有{text}，會略過（表格的第 {rows} 列）', { count: result.skippedRows.length, text: kind === 'words' ? t('詞形') : t('句子'), rows: result.skippedRows.slice(0, 10).join(', ') + (result.skippedRows.length > 10 ? '…' : '') }) }}
            </li>
            <li v-if="result.duplicateRows.length">
              {{ t('{count} 列和現有的資料或前面的列完全相同，會略過（表格的第 {rows} 列）', { count: result.duplicateRows.length, rows: result.duplicateRows.slice(0, 10).join(', ') + (result.duplicateRows.length > 10 ? '…' : '') }) }}
            </li>
          </ul>
          <div v-if="result.unknownDialects.length" class="space-y-1">
            <p>{{ t('方言欄有這些值對不到語言變體：{values}', { values: result.unknownDialects.join('、') }) }}</p>
            <label class="flex items-center gap-2">
              <Checkbox :model-value="addVarieties" @update:model-value="(v) => (addVarieties = v === true)" />
              {{ t('自動新增為語言變體（之後可以在「專案」分頁改名稱與代碼）') }}
            </label>
            <p v-if="!addVarieties" class="text-muted-foreground text-xs">{{ t('不新增時，這些值不會匯入（那些列的方言欄留空）。') }}</p>
          </div>
          <fieldset class="flex flex-wrap gap-x-4 gap-y-2">
            <legend class="sr-only">{{ t('匯入方式') }}</legend>
            <label class="flex items-center gap-2"><input v-model="mode" type="radio" value="append" />{{ t('附加在後面') }}</label>
            <label class="flex items-center gap-2"><input v-model="mode" type="radio" value="replace" />{{ t('取代現有的（{count} 列）', { count: draft[kind].length }) }}</label>
            <label class="flex items-center gap-2">
              <Checkbox :model-value="skipDuplicates" @update:model-value="(v) => (skipDuplicates = v === true)" />
              {{ t('略過完全相同的列') }}
            </label>
          </fieldset>
        </section>
      </template>

      <DialogFooter>
        <Button variant="ghost" @click="open = false">{{ t('取消') }}</Button>
        <Button :disabled="!ready" @click="doImport">{{ t('匯入') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
