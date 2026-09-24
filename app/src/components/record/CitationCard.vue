<script setup>
/**
 * 溯源卡：這筆資料來自哪裡、在來源中的位置、原始出處人、校對狀態，
 * 並可開啟原書掃描頁、複製引用、到來源中瀏覽前後文。
 */
import { BookOpenIcon, CopyIcon, FileImageIcon, ListTreeIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/components/ui/sonner'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { t } from '@/i18n.js'
import { formatTimecode, shardUnitLabel } from '@/lib/labels.js'
import ScanViewer from './ScanViewer.vue'

const props = defineProps({
  /** 標準記錄 */
  record: { type: Object, required: true },
  /** 來源後設資料（useSources 的一筆） */
  source: { type: Object, default: null },
  /** 記錄所在分片的鍵與名稱 */
  shard: { type: Object, required: true },
})

const scanOpen = ref(false)
const citation = computed(() => props.record.citation)

/** 以「欄位名稱：值」列出所有有值的位置資訊 */
const rows = computed(() => {
  const c = citation.value
  /** @type {Array<[string, string]>} */
  const out = []
  if (c.pages?.length) out.push([t('citation.page'), c.pages.map((/** @type {number} */ p) => `p.${p}`).join('–')])
  else if (c.page !== null) out.push([t('citation.page'), `p.${c.page}`])
  if (c.code) out.push([t('citation.code'), c.code])
  if (c.row !== null) out.push([t('citation.row'), t('citation.rowValue', { row: c.row })])
  if (c.file) out.push([t('citation.file'), c.file])
  if (c.timecode) out.push([t('citation.timecode'), `${formatTimecode(c.timecode.start)}–${formatTimecode(c.timecode.end)}`])
  if (props.record.attribution) out.push([t('citation.attribution'), props.record.attribution])
  if (props.record.speaker) out.push([t('citation.speaker'), props.record.speaker])
  return out
})

async function copyCitation() {
  const parts = [props.record.text, citation.value.label]
  if (props.source?.citation) parts.push(props.source.citation)
  const text = parts.join('\n')
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('citation.copied'))
  } catch {
    toast.error(t('citation.copyFailed'))
  }
}
</script>

<template>
  <Card class="gap-4 py-5">
    <CardHeader class="px-5">
      <CardTitle class="flex items-center gap-2 text-base">
        <BookOpenIcon class="text-muted-foreground size-4" />
        {{ t('citation.title') }}
      </CardTitle>
    </CardHeader>
    <CardContent class="space-y-4 px-5 text-sm">
      <div>
        <p class="font-medium">{{ source?.title ?? record.source }}</p>
        <p v-if="source && (source.authors.length || source.year)" class="text-muted-foreground mt-0.5 text-xs">
          {{ source.authors.join(t('common.listSeparator')) }}<template v-if="source.year">（{{ source.year }}）</template>
        </p>
        <p class="mt-2 leading-relaxed">{{ citation.label }}</p>
      </div>

      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        <template v-for="[label, value] in rows" :key="label">
          <dt class="text-muted-foreground">{{ label }}</dt>
          <dd class="break-words">{{ value }}</dd>
        </template>
        <!-- 只有設了校對流程的來源才談校對狀態（見 useSources 的 tracksReview） -->
        <template v-if="source?.reviewTracked">
          <dt class="text-muted-foreground">{{ t('citation.status') }}</dt>
          <dd class="flex flex-wrap items-center gap-1.5">
            <StatusBadge :status="record.quality.status" variant="badge" />
            <span v-if="record.quality.flags.length" class="text-muted-foreground text-xs">
              （{{ record.quality.flags.join(t('common.listSeparator')) }}）
            </span>
          </dd>
        </template>
        <template v-else-if="record.quality.flags.length">
          <dt class="text-muted-foreground">{{ t('citation.flags') }}</dt>
          <dd>{{ record.quality.flags.join(t('common.listSeparator')) }}</dd>
        </template>
      </dl>

      <div class="flex flex-col gap-2">
        <Button v-if="citation.scan" variant="default" class="w-full" @click="scanOpen = true">
          <FileImageIcon /> {{ t('citation.viewScan') }}
        </Button>
        <div class="grid grid-cols-2 gap-2">
          <Button variant="outline" as-child>
            <RouterLink :to="{ name: 'browse', params: { source: record.source, shard: shard.key }, hash: `#${record.id}` }">
              <ListTreeIcon /> {{ t('citation.browseShard', { unit: shardUnitLabel(source) }) }}
            </RouterLink>
          </Button>
          <Button variant="outline" @click="copyCitation"><CopyIcon /> {{ t('citation.copy') }}</Button>
        </div>
      </div>
    </CardContent>
  </Card>

  <ScanViewer
    v-if="citation.scan"
    v-model:open="scanOpen"
    :scan="citation.scan"
    :title="citation.label"
    :description="t('scan.description')"
  />
</template>
