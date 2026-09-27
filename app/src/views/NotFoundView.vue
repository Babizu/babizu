<script setup>
import StateMessage from '@/components/common/StateMessage.vue'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n.js'
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-16">
    <StateMessage :title="t('找不到這個頁面')" :description="t('網址可能打錯了，或頁面已經移動。')">
      <Button as-child><RouterLink to="/">{{ t('回到首頁') }}</RouterLink></Button>
    </StateMessage>
  </div>
</template>
