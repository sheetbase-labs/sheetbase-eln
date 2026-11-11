import { t } from '#/copy'

export const mySessionsQueryKey = ['my-sessions'] as const

export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device'

  const browser =
    /(Edg|Chrome|Firefox|Safari)\/[\d.]+/.exec(userAgent)?.[1] ??
    t('settings.sessions.browser')

  const os = /(Macintosh|Windows|Linux|iPhone|iPad|Android)/.exec(
    userAgent,
  )?.[1]

  const osLabel = os === 'Macintosh' ? 'macOS' : os

  return osLabel ? `${browser} · ${osLabel}` : browser
}
