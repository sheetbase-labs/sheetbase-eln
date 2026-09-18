import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'

/**
 * Square tonal tag for object TYPE and classification (Experiment, Sample,
 * Task, vial…). Pills (Badge, StatusBadge) carry *state*; square tags carry
 * *identity* — the distinction is part of the V2ALT primitives vocabulary.
 */
const typeTagVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-xs px-1.5 py-0.5 text-xs font-medium leading-4',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-muted-foreground',
        info: 'bg-info/10 text-info',
        success: 'bg-success/10 text-success',
        warning: 'bg-warning/20 text-warning-foreground dark:text-warning',
        danger: 'bg-destructive/10 text-destructive',
        violet: 'bg-violet/10 text-violet',
        cyan: 'bg-analysis-cyan/10 text-analysis-cyan',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export type TypeTagTone = NonNullable<
  VariantProps<typeof typeTagVariants>['tone']
>

/** Kind → tone pairing for object-type tags (V2ALT primitive palette). */
export const typeTagKindTones: Record<string, TypeTagTone> = {
  experiment: 'success',
  sample: 'info',
  reagent: 'cyan',
  dataset: 'neutral',
  task: 'info',
  review: 'violet',
  meeting: 'neutral',
  project: 'violet',
  file: 'neutral',
  study: 'success',
}

interface TypeTagProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof typeTagVariants> {}

function TypeTag({ className, tone, ...props }: TypeTagProps) {
  return (
    <span
      data-slot="type-tag"
      className={cn(typeTagVariants({ tone }), className)}
      {...props}
    />
  )
}

export { TypeTag, typeTagVariants, type TypeTagProps }
