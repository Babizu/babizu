<script setup>
/**
 * 搜尋框。
 * - 行動裝置：鍵盤顯示「搜尋」鍵、關閉自動大寫與自動修正（族語拼寫會被亂改）
 * - 框內提供特殊字元按鈕（站台設定的 specialChars），不必切換輸入法；任何寬度都在框內，不另外佔一列
 */
import { SearchIcon, XIcon } from '@lucide/vue'
import { computed, nextTick, ref } from 'vue'
import { t } from '@/i18n.js'
import { site } from '@/lib/labels.js'
import { cn } from '@/lib/utils'

const props = defineProps({
  /** 不指定時用介面字串 search.placeholder */
  placeholder: { type: String, default: '' },
  autofocus: { type: Boolean, default: false },
  /** default／lg */
  size: { type: String, default: 'default' },
  class: { type: null, default: undefined },
})
const emit = defineEmits(['submit'])
const model = defineModel({ type: String, default: '' })

const input = ref(/** @type {HTMLInputElement | null} */ (null))
const SPECIAL_CHARS = site.specialChars
const placeholderText = computed(() => props.placeholder || t('search.placeholder'))

function submit() {
  input.value?.blur()
  emit('submit', model.value.trim())
}

function clear() {
  model.value = ''
  input.value?.focus()
}

/** 在游標位置插入字元 @param {string} ch */
async function insert(ch) {
  const el = input.value
  if (!el) return
  const start = el.selectionStart ?? model.value.length
  const end = el.selectionEnd ?? start
  model.value = model.value.slice(0, start) + ch + model.value.slice(end)
  await nextTick()
  el.focus()
  el.setSelectionRange(start + ch.length, start + ch.length)
}

defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <form
    role="search"
    :class="cn('group relative w-full min-w-0', props.class)"
    @submit.prevent="submit"
  >
    <div
      :class="
        cn(
          'bg-card focus-within:border-ring focus-within:ring-ring/40 flex items-center rounded-xl border transition-[box-shadow,border-color] focus-within:ring-[3px]',
          size === 'lg' ? 'h-14 gap-2 px-4' : 'h-11 gap-1.5 px-3',
        )
      "
    >
      <SearchIcon :class="cn('text-muted-foreground shrink-0', size === 'lg' ? 'size-5' : 'size-4')" aria-hidden="true" />
      <input
        ref="input"
        v-model="model"
        type="search"
        name="q"
        :placeholder="placeholderText"
        :autofocus="autofocus"
        enterkeyhint="search"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        :aria-label="t('nav.search')"
        :class="
          cn(
            'placeholder:text-muted-foreground/80 min-w-0 flex-1 bg-transparent outline-none [&::-webkit-search-cancel-button]:hidden',
            size === 'lg' ? 'text-lg' : 'text-base',
          )
        "
      />
      <button
        v-if="model"
        type="button"
        class="text-muted-foreground hover:text-foreground hover:bg-muted flex size-8 shrink-0 items-center justify-center rounded-sm"
        :aria-label="t('search.clear')"
        @click="clear"
      >
        <XIcon class="size-4" />
      </button>
      <span v-if="SPECIAL_CHARS.length" class="bg-border h-5 w-px shrink-0" aria-hidden="true" />
      <!--
        特殊字元鍵一律留在搜尋框內，任何寬度都一樣。
        曾經在窄螢幕把它移到框外下方，但那樣會多佔一列、把結果往下推；
        而且一旦做成「聚焦時才出現」，手指按在下方選項上時輸入框失焦、整列收合，
        版面上移會害人點到別的項目。放在框內就沒有這些問題。
      -->
      <div v-if="SPECIAL_CHARS.length" class="flex shrink-0 items-center gap-0.5" :aria-label="t('search.specialChars')">
        <button
          v-for="ch in SPECIAL_CHARS"
          :key="ch"
          type="button"
          :class="
            cn(
              'native-text text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center rounded-sm',
              size === 'lg' ? 'size-9 text-base' : 'size-7 text-sm',
            )
          "
          :aria-label="t('search.insertChar', { char: ch })"
          @mousedown.prevent
          @touchstart.prevent="insert(ch)"
          @click="insert(ch)"
        >
          {{ ch }}
        </button>
      </div>
    </div>
  </form>
</template>
