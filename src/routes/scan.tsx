import { useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Status } from '#/components/v3/ui/status'
import { Icon } from '#/components/v3/icons'
import { CameraScanner } from '#/components/scan/camera-scanner'
import {
  resolveScanCode,
  scanTargetActionLabel,
  scanTargetHref,
} from '#/components/v3/scan/scan-data'
import type { ScanResolution, ScanTarget } from '#/components/v3/scan/scan-data'
import { signInRedirect } from '#/lib/sign-in-redirect'

/**
 * UI port (roadmap-4/ui-app3): the Scan screen (MOB-02 / LAB-05). Camera
 * scanning comes from the shared CameraScanner (the browser BarcodeDetector
 * where available); typing an identifier or an "also known as" alias always
 * works. Results resolve against real records and instruments.
 */
export const Route = createFileRoute('/scan')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: ScanPage,
})

function ScanPage() {
  const [code, setCode] = useState('')
  const [result, setResult] = useState<ScanResolution | null>(null)
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState<ScanTarget[]>([])
  const [error, setError] = useState<string | null>(null)

  const resolve = async (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const r = await resolveScanCode(trimmed)
      setResult(r)
      if (r.found && r.hit) {
        const hit = r.hit
        setRecent((xs) =>
          [hit, ...xs.filter((x) => x.id !== hit.id)].slice(0, 5),
        )
      }
    } catch (cause) {
      // A failed lookup is not a miss: say the code could not be read rather
      // than stopping the spinner with nothing on screen.
      setResult(null)
      setError(
        cause instanceof Error
          ? cause.message
          : 'The code could not be looked up.',
      )
    } finally {
      setBusy(false)
    }
  }

  const hit = result?.found ? result.hit : undefined
  const miss = result && !result.found ? result : undefined

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-4 md:py-6">
        <h1 className="font-heading text-title font-semibold">Scan a label</h1>

        <CameraScanner
          value={code}
          onValueChange={setCode}
          busy={busy}
          onScan={(raw) => void resolve(raw)}
        >
          {hit ? (
            <section
              aria-label="Scanned record"
              className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
            >
              <div className="flex items-center gap-3">
                <span className="text-success">
                  <Icon name="check" size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mono text-fg-muted">{hit.identifier}</div>
                  <div className="text-[15px] font-semibold">{hit.title}</div>
                  <div className="text-label text-fg-muted">
                    {hit.line}
                    {hit.matchedAlias ? (
                      <> · also known as {hit.matchedAlias}</>
                    ) : null}
                  </div>
                </div>
                <Status tone={hit.status.tone}>{hit.status.label}</Status>
              </div>
              <Button
                variant="primary"
                size="lg"
                nativeButton={false}
                render={<Link {...scanTargetHref(hit)} />}
              >
                {scanTargetActionLabel(hit)}
              </Button>
            </section>
          ) : null}

          {miss ? (
            <Notice tone="warn" title={`No record with ID ${miss.code}.`}>
              {miss.suggestions.length ? (
                <>
                  Did you mean{' '}
                  {miss.suggestions.map((s, i) => (
                    <span key={s.id}>
                      {i ? ', ' : ''}
                      <button
                        type="button"
                        className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link underline"
                        onClick={() => {
                          setCode(s.identifier)
                          void resolve(s.identifier)
                        }}
                      >
                        {s.identifier}
                      </button>
                    </span>
                  ))}
                  ?
                </>
              ) : (
                'Check the label and try again.'
              )}
            </Notice>
          ) : null}

          {error ? (
            <Notice tone="bad" title="Could not resolve this code.">
              {error}
            </Notice>
          ) : null}
        </CameraScanner>

        {recent.length ? (
          <section className="flex flex-col gap-1">
            <h2 className="text-label font-medium text-fg-muted">
              Recent scans
            </h2>
            {recent.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() =>
                  setResult({
                    found: true,
                    code: r.identifier,
                    hit: r,
                    suggestions: [],
                  })
                }
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-2 text-left font-[inherit] hover:bg-surface-hover"
              >
                <span className="mono w-24 text-fg-muted">{r.identifier}</span>
                <span className="flex-1 truncate text-body">{r.title}</span>
                <Status tone={r.status.tone}>{r.status.label}</Status>
              </button>
            ))}
          </section>
        ) : (
          <p className="m-0 text-label text-fg-muted">
            Scans you resolve this session appear here.
          </p>
        )}
      </div>
    </div>
  )
}
