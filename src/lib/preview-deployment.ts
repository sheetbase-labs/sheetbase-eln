import { z } from 'zod'

/** Bounds for disposable PR resources. Production remains on port 3000. */
export const PREVIEW_LIMITS = {
  maxActivePreviews: 4,
  maxPullRequestNumber: 9999,
  appPortBase: 32000,
  routerPort: 31000,
} as const

const routeSchema = z.object({
  pullRequestNumber: z.number().int().positive(),
  hostname: z.string().regex(/^pr-\d+\.[a-z0-9.-]+$/),
  target: z.string().regex(/^http:\/\/127\.0\.0\.1:\d+$/),
  appPort: z
    .number()
    .int()
    .min(PREVIEW_LIMITS.appPortBase + 1)
    .max(41999),
  updatedAt: z.string().datetime(),
})

export type PreviewRoute = z.infer<typeof routeSchema>

export function parsePullRequestNumber(value: string | number): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > PREVIEW_LIMITS.maxPullRequestNumber
  ) {
    throw new Error(
      `pull request number must be an integer from 1 to ${PREVIEW_LIMITS.maxPullRequestNumber}`,
    )
  }
  return number
}

export function previewHostname(
  pullRequestNumber: string | number,
  baseDomain: string,
): string {
  const number = parsePullRequestNumber(pullRequestNumber)
  const domain = baseDomain.trim().toLowerCase()
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain)) {
    throw new Error('preview base domain must be a DNS hostname')
  }
  return `pr-${number}.${domain}`
}

export function previewProjectName(pullRequestNumber: string | number): string {
  return `sheetbase-pr-${parsePullRequestNumber(pullRequestNumber)}`
}

export function previewAppPort(pullRequestNumber: string | number): number {
  return PREVIEW_LIMITS.appPortBase + parsePullRequestNumber(pullRequestNumber)
}

export function previewRoute(
  pullRequestNumber: string | number,
  baseDomain: string,
  updatedAt = new Date().toISOString(),
): PreviewRoute {
  const number = parsePullRequestNumber(pullRequestNumber)
  const appPort = previewAppPort(number)
  return {
    pullRequestNumber: number,
    hostname: previewHostname(number, baseDomain),
    target: `http://127.0.0.1:${appPort}`,
    appPort,
    updatedAt,
  }
}

export function normalizePreviewRoutes(input: unknown): PreviewRoute[] {
  if (!Array.isArray(input)) {
    throw new Error('preview route registry must be an array')
  }
  return input.map((route) => routeSchema.parse(route))
}

export function upsertPreviewRoute(
  routes: PreviewRoute[],
  route: PreviewRoute,
): PreviewRoute[] {
  const current = normalizePreviewRoutes(routes)
  const withoutCurrent = current.filter(
    (candidate) => candidate.pullRequestNumber !== route.pullRequestNumber,
  )
  if (withoutCurrent.length >= PREVIEW_LIMITS.maxActivePreviews) {
    throw new Error(
      `preview capacity reached (${PREVIEW_LIMITS.maxActivePreviews} active previews)`,
    )
  }
  if (
    withoutCurrent.some(
      (candidate) =>
        candidate.hostname === route.hostname ||
        candidate.appPort === route.appPort,
    )
  ) {
    throw new Error('preview hostname or loopback port is already allocated')
  }
  return [...withoutCurrent, route].sort(
    (left, right) => left.pullRequestNumber - right.pullRequestNumber,
  )
}

export function removePreviewRoute(
  routes: PreviewRoute[],
  pullRequestNumber: string | number,
): PreviewRoute[] {
  const number = parsePullRequestNumber(pullRequestNumber)
  return normalizePreviewRoutes(routes).filter(
    (route) => route.pullRequestNumber !== number,
  )
}
