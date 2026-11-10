/**
 * The callout's four contract tones.
 *
 * The payload contract (`validateCallout`) accepts `info`, `warning`, `note`
 * and `danger`, and nothing else. The read view and the editor both draw a
 * tone from here, so the block looks the same whether it is being read or
 * written — an editor that replaced the callout with a form field would make
 * the author lose the shape of what they are editing.
 */

import type { IconName } from '#/components/icons'
import { z } from 'zod'

export interface CalloutStyle {
  container: string
  icon: IconName
  iconClass: string
}

export const CALLOUT_STYLES = {
  info: {
    container: 'bg-info/[0.07] text-fg',
    icon: 'info',
    iconClass: 'text-info',
  },
  warning: {
    container: 'bg-warning/[0.09] text-fg',
    icon: 'warn',
    iconClass: 'text-warning-text',
  },
  danger: {
    container: 'bg-destructive/[0.07] text-fg',
    icon: 'warn',
    iconClass: 'text-danger-text',
  },
  note: {
    container: 'bg-success/[0.07] text-fg',
    icon: 'comment',
    iconClass: 'text-success-text',
  },
} satisfies Record<CalloutVariant, CalloutStyle>

/** The tones the contract accepts, in menu order. */
export const CALLOUT_VARIANTS = ['info', 'warning', 'note', 'danger'] as const

export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number]

export const CALLOUT_VARIANT_LABELS: Record<CalloutVariant, string> = {
  info: 'Information',
  warning: 'Warning',
  note: 'Note',
  danger: 'Danger',
}

/** The tone named by a payload, or `info` when it names none. */
const calloutVariant = z.enum(CALLOUT_VARIANTS).catch('info')
export const calloutVariantOf = calloutVariant.parse.bind(calloutVariant)
