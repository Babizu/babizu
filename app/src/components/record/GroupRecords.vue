<script setup>
/**
 * 一個群組中的所有記錄，依原來源的順序（seq）排列，並依 parent 關係縮排：
 * - 辭典詞條：詞條 → 派生詞 → 其下的例句
 * - 錄音：逐句排列，可逐句播放
 * - 清單類：只顯示目前記錄前後幾筆（避免一次列出上百筆）
 */
import { computed } from 'vue'
import RecordLine from './RecordLine.vue'
import { t } from '@/i18n.js'

const props = defineProps({
  group: { type: Object, required: true },
  records: { type: Array, required: true },
  /** 目前檢視的記錄 id（高亮） */
  activeId: { type: String, default: '' },
  /** 清單類群組只顯示目前記錄前後幾筆；0 表示全部顯示 */
  window: { type: Number, default: 0 },
})

const ordered = computed(() => {
  const list = [...props.records].sort((a, b) => (a.group?.seq ?? 0) - (b.group?.seq ?? 0))
  const byId = new Map(list.map((r) => [r.id, r]))
  /** @param {any} r */
  const depthOf = (r) => {
    if (r.group?.role === 'head') return 0
    let depth = props.group.type === 'entry' ? 1 : 0
    let parent = r.group?.parent ? byId.get(r.group.parent) : null
    const seen = new Set()
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id)
      depth++
      parent = parent.group?.parent ? byId.get(parent.group.parent) : null
    }
    return depth
  }
  return list.map((r) => ({ record: r, depth: depthOf(r) }))
})

const visible = computed(() => {
  if (!props.window) return ordered.value
  const k = ordered.value.findIndex((x) => x.record.id === props.activeId)
  if (k < 0) return ordered.value.slice(0, props.window * 2 + 1)
  return ordered.value.slice(Math.max(0, k - props.window), k + props.window + 1)
})
</script>

<template>
  <div class="space-y-0.5">
    <RecordLine
      v-for="item in visible"
      :key="item.record.id"
      :record="item.record"
      :depth="item.depth"
      :active="item.record.id === activeId"
    />
    <p v-if="window && visible.length < ordered.length" class="text-muted-foreground px-3 pt-2 text-xs">
      {{ t('group.windowed', { total: ordered.length, window }) }}
    </p>
  </div>
</template>
