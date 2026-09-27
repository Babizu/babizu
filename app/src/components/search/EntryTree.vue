<script setup>
/**
 * 詞條家族的子項目（樹狀、逐層縮排）。左邊的細線表示「屬於上面那一列」。
 *
 * 同一層依子樹中最好的分數排序（見 babizu/search 的 family.js），只先顯示前幾項，
 * 其餘收在「再顯示」按鈕後面：一個詞根可能有十幾個衍生詞，全部展開會把其他結果擠到很下面。
 */
import { computed, ref } from 'vue'
import { t } from '@/i18n.js'
import { visibleCount } from '@/lib/entry-groups.js'
import EntryRow from './EntryRow.vue'

defineOptions({ name: 'EntryTree' })

const props = defineProps({
  /** EntryNode[] */
  nodes: { type: Array, required: true },
  query: { type: String, default: '' },
  depth: { type: Number, default: 0 },
})

const expanded = ref(false)
const shown = computed(() => (expanded.value ? props.nodes : props.nodes.slice(0, visibleCount(props.nodes.length, props.depth))))
/** 收起來的項目中命中的記錄數 */
const hiddenHits = computed(() =>
  props.nodes.slice(shown.value.length).reduce((n, /** @type {any} */ node) => n + node.hits, 0),
)
</script>

<template>
  <ul class="border-border ml-3 border-l pl-1.5 sm:ml-4 sm:pl-2">
    <li v-for="node in shown" :key="node.doc.id">
      <EntryRow :node="node" :query="query" />
      <EntryTree v-if="node.children.length" :nodes="node.children" :query="query" :depth="depth + 1" />
    </li>
    <li v-if="shown.length < nodes.length">
      <button
        type="button"
        class="text-primary min-h-9 rounded-md px-2 text-left text-sm font-medium hover:underline"
        @click="expanded = true"
      >
        {{ t('再顯示 {count} 個相關項目', { count: hiddenHits }) }}
      </button>
    </li>
  </ul>
</template>
