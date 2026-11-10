import { cva } from 'class-variance-authority'

// Tags mark changes in a diff (add / chg / del). Kind labels a record type. Never use either for status.
export const badgeVariants = cva(
  'inline-flex items-center whitespace-nowrap rounded-sm font-medium',
  {
    variants: {
      variant: {
        add: 'bg-success-wash px-1.5 py-px text-[11px] text-success-text',
        chg: 'bg-warning-wash px-1.5 py-px text-[11px] text-warning-text',
        del: 'bg-danger-wash px-1.5 py-px text-[11px] text-danger-text',
        kind: 'border border-border bg-surface px-[5px] py-px font-mono text-[10px] tracking-[.02em] text-fg-muted',
      },
    },
    defaultVariants: { variant: 'chg' },
  },
)
