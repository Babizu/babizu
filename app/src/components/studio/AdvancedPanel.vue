<script setup lang="ts">
/**
 * 工作台的「進階」分頁：整份語言設定檔的 JSON（其他分頁沒有的欄位、構詞文法等都在這裡改），
 * 套用前先檢查（JSON 格式、validateProfile）。欄位說明見 babizu 的 docs/language-profile.md。
 */
import { CheckIcon, RotateCcwIcon } from '@lucide/vue'
import { validateProfile, type LanguageProfile } from '#bcdp'
import { ref, watch, reactive } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n.ts'
import { draft as studioDraft, issues } from '@/playground/studio.ts'

/** 草稿（以 reactive 取用：模板裡直接改它的欄位，Vue 才知道它不是 ref） */
const draft = reactive(studioDraft)

const text = ref('')
const errors = ref<string[]>([])
const edited = ref(false)

/** 從草稿重新產生文字（其他分頁改了設定檔時也跟著更新，除非這裡有還沒套用的修改） */
function reload() {
  text.value = JSON.stringify(draft.profile, null, 2)
  errors.value = []
  edited.value = false
}
watch(
  () => JSON.stringify(draft.profile),
  () => {
    if (!edited.value) reload()
  },
  { immediate: true },
)

function apply() {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.value)
  } catch (err) {
    errors.value = [t('JSON 格式錯誤：{message}', { message: (err as Error).message })]
    return
  }
  const problems = validateProfile(parsed)
  if (problems.length) {
    errors.value = problems
    return
  }
  draft.profile = parsed as LanguageProfile
  edited.value = false
  errors.value = []
  toast.success(t('已套用語言設定檔'))
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-muted-foreground max-w-3xl text-sm leading-relaxed">
      {{ t('整份語言設定檔（方言規則、構詞、正規化、成本）。其他分頁改的也會反映在這裡；在這裡改完按「套用」。') }}
    </p>
    <textarea
      v-model="text"
      rows="24"
      spellcheck="false"
      class="border-input focus-visible:border-ring focus-visible:ring-ring/50 native-text w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:ring-[3px]"
      :aria-label="t('語言設定檔（JSON）')"
      :aria-invalid="errors.length > 0 || undefined"
      @input="edited = true"
    />
    <div class="flex flex-wrap gap-2">
      <Button size="sm" :disabled="!edited" @click="apply"><CheckIcon />{{ t('套用') }}</Button>
      <Button variant="ghost" size="sm" :disabled="!edited" @click="reload"><RotateCcwIcon />{{ t('還原') }}</Button>
    </div>
    <ul v-if="errors.length" class="text-destructive list-disc space-y-0.5 pl-6 text-sm">
      <li v-for="(e, k) in errors" :key="k">{{ e }}</li>
    </ul>
    <section v-if="issues.some((i) => i.path.startsWith('profile'))" class="text-sm">
      <h2 class="font-semibold">{{ t('建置前的檢查') }}</h2>
      <ul class="text-destructive mt-1 list-disc space-y-0.5 pl-6">
        <li v-for="(i, k) in issues.filter((x) => x.path.startsWith('profile'))" :key="k">{{ i.message }}</li>
      </ul>
    </section>
  </div>
</template>
