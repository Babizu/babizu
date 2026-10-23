<script setup lang="ts">
/**
 * 工作台的確認視窗（playground/confirm.ts 的 askConfirm 開啟）。取消、Esc、點外面都算「不要」。
 */
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/i18n.ts'
import { answerConfirm, pendingConfirm } from '@/playground/confirm.ts'
</script>

<template>
  <Dialog :open="!!pendingConfirm" @update:open="(open) => !open && answerConfirm(false)">
    <DialogContent v-if="pendingConfirm" class="sm:max-w-md" :show-close-button="false">
      <DialogHeader>
        <DialogTitle>{{ pendingConfirm.title }}</DialogTitle>
        <DialogDescription class="leading-relaxed whitespace-pre-line">{{ pendingConfirm.message }}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" @click="answerConfirm(false)">{{ t('取消') }}</Button>
        <Button :variant="pendingConfirm.destructive ? 'destructive' : 'default'" @click="answerConfirm(true)">{{ pendingConfirm.confirm }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
