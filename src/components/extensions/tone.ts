import type { CellDisplayTone } from '#/lib/extensions/cell-display'

/** The wash and text colours a plugin tone maps to. Plugins choose a tone, never a colour. */
export const TONE_CLASSES: Record<CellDisplayTone, string> = {
  neutral: 'bg-surface-muted text-fg-muted',
  success: 'bg-success-wash text-success-text',
  warning: 'bg-warning-wash text-warning-text',
  danger: 'bg-danger-wash text-danger-text',
  info: 'bg-selection text-link',
}

/** Fill and stroke for bars and sparklines. */
export const TONE_FILL: Record<CellDisplayTone, string> = {
  neutral: 'bg-fg-muted',
  success: 'bg-success',
  warning: 'bg-warning-text',
  danger: 'bg-danger-text',
  info: 'bg-link',
}

export const TONE_STROKE: Record<CellDisplayTone, string> = {
  neutral: 'stroke-fg-muted',
  success: 'stroke-success',
  warning: 'stroke-warning-text',
  danger: 'stroke-danger-text',
  info: 'stroke-link',
}
