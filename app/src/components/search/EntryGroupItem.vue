<script setup>
/**
 * 搜尋結果中的一個詞條家族：辭典已經確認屬於同一個詞條的命中排在一起。
 * 詞條（家族的代表，通常是詞根）固定在最上面，底下依辭典的上下層關係縮排列出命中的詞形、例句與另立的衍生詞條。
 * 只有一筆時與一般的詞條列相同。
 */
import { computed } from 'vue'
import { displayHit, isSingle } from '@/lib/entry-groups.js'
import EntryHitItem from './EntryHitItem.vue'
import EntryTree from './EntryTree.vue'

const props = defineProps({
  /** search 引擎的 EntryGroup：{ root, best, hits } */
  group: { type: Object, required: true },
  query: { type: String, default: '' },
})

const root = computed(() => props.group.root)
</script>

<template>
  <EntryHitItem v-if="isSingle(group)" :hit="root.hit" :query="query" data-entry-group />
  <div v-else class="pb-2" data-entry-group>
    <EntryHitItem :hit="displayHit(root)" :doc="root.doc" :query="query" />
    <EntryTree :nodes="root.children" :query="query" class="-mt-1 mr-1" />
  </div>
</template>
