import { cva } from 'class-variance-authority'

export { default as Badge } from './Badge.vue'

/** 徽章樣式變體 */
export const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] transition-[color,box-shadow] overflow-hidden',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary: 'border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive:
          'border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline: 'text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        // 以下是結果列的標籤（ui-guidelines.md「標籤」）：同一個尺寸（size: tag），只差在顏色
        /** 低調的屬性：外框、次要字色 */
        quiet: 'text-muted-foreground [button&]:hover:bg-muted',
        /** 說明性的標記（語音規則、構詞）：淡主色底 */
        soft: 'border-transparent bg-accent text-accent-foreground [button&]:hover:bg-accent/70',
        /** 演算法推定的關係（自動拆解、派生、同根）：虛線外框，與辭典標註的實心底（soft）一眼分得出來 */
        inferred: 'border-dashed border-primary/40 bg-transparent text-accent-foreground [button&]:hover:bg-accent/60',
        /** 中性的底色（未知的語言變體） */
        muted: 'border-transparent bg-muted text-muted-foreground',
        /** 語言變體：顏色由 .variety-<代碼> 提供 */
        variety: 'border-transparent bg-[var(--variety-bg)] text-[var(--variety-fg)]',
      },
      size: {
        default: '',
        /** 結果列的標籤：與方言徽章同高 20px，同一行的標籤上下對齊 */
        tag: 'h-5 rounded-sm px-1.5 py-0 text-[11px] leading-none',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)
