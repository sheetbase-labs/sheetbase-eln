import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'

/**
 * Banner and Notice (DSYS-03), split from the old `Alert`.
 *
 * - `Banner` is a full-width strip under the page header for a whole-page
 *   state (offline, reviewing, locked, conflict): 8px/24px padding, 12px
 *   text, a bottom border and a wash.
 * - `Notice` is a local message beside the thing it describes: 10px/12px
 *   padding, radius 6, 12px text and a wash.
 *
 * Status is conveyed by text as well as colour. `Alert` is kept as a local
 * alias of `Notice` while call sites are migrated.
 */
const noticeTones = {
  info: 'bg-muted text-foreground',
  plain: 'border border-border bg-card text-foreground',
  warn: 'bg-warning-wash text-foreground',
  bad: 'bg-danger-wash text-foreground',
  success: 'bg-success-wash text-foreground',
  review: 'bg-review-wash text-foreground',
} as const

const noticeVariants = cva('rounded-md px-3 py-2.5 text-caption', {
  variants: { tone: noticeTones },
  defaultVariants: { tone: 'info' },
})

const bannerVariants = cva(
  'flex w-full items-center gap-2.5 border-b border-border bg-muted px-6 py-2 text-caption',
  {
    variants: {
      tone: {
        plain: '',
        info: '',
        warn: 'border-warning-border bg-warning-wash',
        bad: 'border-danger-border bg-danger-wash',
        success: 'border-border bg-success-wash',
        review: 'border-border bg-review-wash',
      },
    },
    defaultVariants: { tone: 'plain' },
  },
)

type Tone = NonNullable<VariantProps<typeof noticeVariants>['tone']>

interface BannerProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bannerVariants> {}

function Banner({ className, tone, ...props }: BannerProps) {
  return (
    <div
      data-slot="banner"
      className={cn(bannerVariants({ tone }), className)}
      {...props}
    />
  )
}

interface NoticeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof noticeVariants> {}

function Notice({ className, tone, ...props }: NoticeProps) {
  return (
    <div
      data-slot="notice"
      className={cn(noticeVariants({ tone }), className)}
      {...props}
    />
  )
}

function NoticeTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h5
      data-slot="notice-title"
      className={cn('text-label', className)}
      {...props}
    />
  )
}

function NoticeDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <div
      data-slot="notice-description"
      className={cn('text-caption', className)}
      {...props}
    />
  )
}

/**
 * `Alert` is the v2 name for a local `Notice`. Kept as an alias while call
 * sites migrate; `variant` maps to the v3 tones.
 */
const alertVariants = cva('rounded-md px-3 py-2.5 text-caption', {
  variants: {
    variant: {
      default: noticeTones.plain,
      destructive: noticeTones.bad,
      warning: noticeTones.warn,
      info: noticeTones.info,
    },
  },
  defaultVariants: { variant: 'default' },
})

interface AlertProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

const AlertTitle = NoticeTitle
const AlertDescription = NoticeDescription

export {
  Banner,
  Notice,
  NoticeTitle,
  NoticeDescription,
  Alert,
  AlertTitle,
  AlertDescription,
  bannerVariants,
  noticeVariants,
  alertVariants,
  type BannerProps,
  type NoticeProps,
  type AlertProps,
  type Tone,
}
