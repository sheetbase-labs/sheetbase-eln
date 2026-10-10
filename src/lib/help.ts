/**
 * Help centre data: what varies per deployment. Guides, articles and
 * shortcuts are static content bundled with the release
 * (`#/components/v3/help/help-content`); this answers the running release and
 * the support desk.
 *
 * Support requests need a service-desk integration, which is not built, so
 * `support.integrated` is false and the screen shows the honest
 * CapabilityGap instead of a form.
 */
import { useQuery } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'

import type { Tone } from '#/components/v3/ui/status'

export interface ReleaseInfo {
  version: string
  build: string
  released: string
  validation: { tone: Tone; label: string; detail: string }
  statement: string
}

export interface HelpSupport {
  hours: string
  urgent: string
  diagnostics: string[]
  notIncluded: string
  integrated: boolean
}

export interface HelpData {
  release: ReleaseInfo
  support: HelpSupport
}

const SUPPORT: HelpSupport = {
  hours: 'Mon–Fri, 08:00–18:00 UK time',
  urgent: 'For anything stopping GMP work, contact the IT service desk.',
  diagnostics: [
    'Release and build',
    'Browser and operating system',
    'The page you were on and the last 20 errors it logged',
    'Your user name and workspace',
  ],
  notIncluded: 'Record contents, data values and files are never included.',
  integrated: false,
}

/** Derive the release card from deployment inputs; pure, so it is testable. */
export function releaseFromEnv(
  env: Record<string, string | undefined> = process.env,
): ReleaseInfo {
  const version = env.SHEETBASE_ARTIFACT_VERSION || '0.0.0-dev'
  const digest = env.SHEETBASE_ARTIFACT_DIGEST || ''
  const environment = env.SHEETBASE_ENV || 'development'
  const validated = environment === 'staging' || environment === 'production'
  return {
    version,
    build: digest ? digest.replace(/^sha256:/, '').slice(0, 12) : version,
    released: '',
    validation: validated
      ? {
          tone: 'ok',
          label: 'Validated',
          detail: 'Validated for GxP use under change control.',
        }
      : {
          tone: 'warn',
          label: 'Development build',
          detail: 'Not a validated release.',
        },
    statement: '21 CFR Part 11 / EU GMP Annex 11 controlled system',
  }
}

const getHelpFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<HelpData> => ({
    release: releaseFromEnv(),
    support: SUPPORT,
  }),
)

export function useHelp() {
  const query = useQuery({
    queryKey: ['help'],
    queryFn: () => getHelpFn(),
    staleTime: Infinity,
  })
  return query.data
}
