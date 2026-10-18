<script setup lang="ts">
/**
 * 匯出「網站起始包」（zip）：站台設定、語言設定檔與資料集，交給網站維護者變成正式的 Babizu 站台。
 */
import { PackageIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n.ts'
import { download, draft, projectFileName } from '@/playground/studio.ts'
import { siteStarterFiles } from '@babizu/playground/export.ts'
import { createZip } from '@babizu/playground/zip.ts'

function exportSite() {
  const zip = createZip(siteStarterFiles(JSON.parse(JSON.stringify(draft))))
  download(projectFileName('-babizu-site.zip'), zip, 'application/zip')
}
</script>

<template>
  <Button variant="outline" size="sm" :title="t('站台設定、語言設定檔與資料集，交給網站維護者發布成正式的辭典網站')" @click="exportSite">
    <PackageIcon />
    {{ t('匯出網站起始包') }}
  </Button>
</template>
