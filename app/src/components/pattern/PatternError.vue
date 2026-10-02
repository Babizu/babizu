<script setup>
/**
 * 句型查詢的語法錯誤：以等寬字顯示查詢，在出錯的範圍下畫波浪線，下面是說明與建議。
 * 查詢可能本來就不是句型（自動判斷誤判），所以一定附上「改用一般搜尋」。
 */
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n.js'
import { patternIssueText } from '@/lib/pattern.js'

const props = defineProps({
  query: { type: String, required: true },
  /** PatternIssue */
  error: { type: Object, required: true },
})
const emit = defineEmits(['plain'])

const parts = computed(() => {
  const { start, end } = props.error
  const q = props.query
  // 範圍是空的（查詢結尾缺東西）時，在結尾標一個空格
  return { before: q.slice(0, start), at: q.slice(start, end) || ' ', after: q.slice(Math.max(end, start)) }
})
const message = computed(() => patternIssueText(/** @type {any} */ (props.error)))
</script>

<template>
  <div class="border-destructive/30 rounded-lg border px-4 py-4" role="alert">
    <p class="font-medium">{{ t('句型的寫法有問題') }}</p>
    <p class="bg-muted/60 mt-3 overflow-x-auto rounded-md px-3 py-2 font-mono text-sm whitespace-pre">{{ parts.before }}<span class="decoration-destructive underline decoration-wavy underline-offset-4">{{ parts.at }}</span>{{ parts.after }}</p>
    <p class="mt-3 text-sm">{{ message.text }}</p>
    <p v-if="message.hint" class="text-muted-foreground mt-1 text-sm">{{ message.hint }}</p>
    <div class="mt-4 flex flex-wrap gap-2">
      <Button variant="outline" size="sm" @click="emit('plain')">{{ t('改用一般搜尋') }}</Button>
      <Button variant="ghost" size="sm" as-child>
        <RouterLink :to="{ name: 'about', hash: '#pattern' }">{{ t('句型的寫法') }}</RouterLink>
      </Button>
    </div>
  </div>
</template>
