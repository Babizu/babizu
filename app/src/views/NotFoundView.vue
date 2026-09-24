<script setup>
import StateMessage from '@/components/common/StateMessage.vue'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n.js'
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-16">
    <StateMessage :title="t('notFound.title')" :description="t('notFound.hint')">
      <Button as-child><RouterLink to="/">{{ t('notFound.home') }}</RouterLink></Button>
    </StateMessage>
  </div>
</template>
