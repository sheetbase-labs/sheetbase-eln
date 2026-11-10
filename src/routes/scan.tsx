import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import { CameraScanner } from '#/components/scan/camera-scanner'
import type { ScanResolution, ScanTarget } from '#/components/scan/scan-data'
import { useScanCodeResolver } from '#/components/scan/plugin-scan'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'
import { z } from 'zod'

import {
  ScanErrorNotice,
  ScanHitCard,
  ScanMissNotice,
  ScanRecentList,
} from './-scan-results'

/**
 * UI port (roadmap-4/ui-app3): the Scan screen (MOB-02 / LAB-05). Camera
 * scanning comes from the shared CameraScanner (the browser BarcodeDetector
 * where available); typing an identifier or an "also known as" alias always
 * works. Results resolve against real records and instruments.
 */
/** The Scan screen's search: the code it was opened with, if any. */
interface ScanSearch {
  code?: string
}

export const Route = createFileRoute('/scan')({
  // A detour from a result (Record reading, Book) comes back with the code, so
  // the scan reappears resolved instead of empty.
  validateSearch: (search): ScanSearch => {
    const code = z.string().safeParse(search.code)

    if (!code.success || !code.data.trim()) return {}

    return { code: code.data.trim() }
  },
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: ScanPage,
})

/** How many resolved codes the session remembers. */
const RECENT_LIMIT = 5

function ScanPage() {
  const search = Route.useSearch()
  const [code, setCode] = useState(search.code ?? '')
  const [result, setResult] = useState<ScanResolution | null>(null)
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState<ScanTarget[]>([])
  const [error, setError] = useState<string | null>(null)
  const resolveScanCode = useScanCodeResolver()

  const resolve = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim()

      if (!trimmed) return
      setBusy(true)
      setError(null)

      try {
        const resolution = await resolveScanCode(trimmed)
        setResult(resolution)

        if (resolution.found && resolution.hit) {
          const hit = resolution.hit
          setRecent((resolved) =>
            [hit, ...resolved.filter((other) => other.id !== hit.id)].slice(
              0,
              RECENT_LIMIT,
            ),
          )
        }
      } catch (cause) {
        // A failed lookup is not a miss: say the code could not be read rather
        // than stopping the spinner with nothing on screen.
        setResult(null)
        setError(
          cause instanceof Error
            ? cause.message
            : t('library.scan.page.theCodeCouldNotBe'),
        )
      } finally {
        setBusy(false)
      }
    },
    [resolveScanCode],
  )

  // Resolve the code the page was opened with once, on arrival; the ref is
  // cleared so a later resolver identity does not scan it again.
  const startedWith = useRef<string | undefined>(search.code)

  useEffect(() => {
    const arrivedWith = startedWith.current

    startedWith.current = undefined

    if (arrivedWith) void resolve(arrivedWith)
  }, [resolve])

  const hit = result?.found ? result.hit : undefined
  const miss = result && !result.found ? result : undefined

  const openRecent = (target: ScanTarget) =>
    setResult({
      found: true,
      code: target.identifier,
      hit: target,
      suggestions: [],
    })

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-4 md:py-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-title font-semibold">
            {t('library.scan.page.scanALabel')}
          </h1>
          <span className="flex-1" />
          <Link
            to="/stocktake"
            className="text-label text-link underline-offset-2 hover:underline"
          >
            {t('library.stocktake.quickLink')}
          </Link>
        </div>

        <CameraScanner
          value={code}
          onValueChange={setCode}
          busy={busy}
          onScan={(raw) => void resolve(raw)}
        >
          {hit ? (
            <ScanHitCard
              hit={hit}
              onChanged={() => void resolve(hit.identifier)}
            />
          ) : null}

          {miss ? (
            <ScanMissNotice
              code={miss.code}
              suggestions={miss.suggestions}
              onPick={(identifier) => {
                setCode(identifier)
                void resolve(identifier)
              }}
            />
          ) : null}

          {error ? <ScanErrorNotice message={error} /> : null}
        </CameraScanner>

        <ScanRecentList recent={recent} onOpen={openRecent} />
      </div>
    </div>
  )
}
