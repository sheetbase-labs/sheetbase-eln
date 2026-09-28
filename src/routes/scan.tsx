import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Status } from '#/components/v3/ui/status'
import { Icon } from '#/components/v3/icons'
import {
  resolveScanCode,
  scanTargetActionLabel,
  scanTargetHref,
} from '#/components/v3/scan/scan-data'
import type { ScanResolution, ScanTarget } from '#/components/v3/scan/scan-data'

/**
 * UI port (roadmap-4/ui-app3): the Scan screen (MOB-02 / LAB-05). Camera
 * scanning uses the browser BarcodeDetector where available; typing an
 * identifier always works. Results resolve against real records and
 * instruments. Aliases are not modelled yet, so only canonical identifiers
 * resolve and that is stated rather than faked.
 */
export const Route = createFileRoute('/scan')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ScanPage,
})

type Detector = {
  detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]>
}
declare global {
  interface Window {
    BarcodeDetector?: new (o?: { formats: string[] }) => Detector
  }
}

function ScanPage() {
  const video = useRef<HTMLVideoElement>(null)
  const [camera, setCamera] = useState<
    'off' | 'starting' | 'on' | 'unsupported' | 'denied'
  >('off')
  const [code, setCode] = useState('')
  const [result, setResult] = useState<ScanResolution | null>(null)
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState<ScanTarget[]>([])

  const resolve = async (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      const r = await resolveScanCode(trimmed)
      setResult(r)
      if (r.found && r.hit) {
        const hit = r.hit
        setRecent((xs) =>
          [hit, ...xs.filter((x) => x.id !== hit.id)].slice(0, 5),
        )
      }
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (camera !== 'starting') return
    let stream: MediaStream | undefined
    const control = { stopped: false }
    void (async () => {
      if (!('BarcodeDetector' in window)) {
        setCamera('unsupported')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (!video.current) return
        video.current.srcObject = stream
        await video.current.play()
        setCamera('on')
        const detector = new window.BarcodeDetector!({
          formats: ['qr_code', 'data_matrix', 'code_128'],
        })
        const shouldStop = () => control.stopped
        while (!shouldStop()) {
          const codes = await detector.detect(video.current).catch(() => [])
          for (const detected of codes) {
            setCode(detected.rawValue)
            await resolve(detected.rawValue)
            break
          }
          await new Promise((r) => setTimeout(r, 250))
        }
      } catch {
        setCamera('denied')
      }
    })()
    return () => {
      control.stopped = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [camera])

  const hit = result?.found ? result.hit : undefined
  const miss = result && !result.found ? result : undefined

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-4 md:py-6">
        <h1 className="font-heading text-title font-semibold">Scan a label</h1>
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-inverse-bg text-inverse-text">
          <video
            ref={video}
            muted
            playsInline
            className={
              camera === 'on'
                ? 'absolute inset-0 size-full object-cover'
                : 'hidden'
            }
          />
          <div
            aria-hidden="true"
            className="absolute h-[55%] w-[70%] rounded-2xl border-[3px] border-primary"
          />
          {camera !== 'on' ? (
            <div className="relative flex flex-col items-center gap-3 px-6 text-center">
              <Icon name="scan" size={28} />
              {camera === 'unsupported' ? (
                <p className="m-0 text-body">
                  This browser can’t read labels from the camera. Type the ID
                  below.
                </p>
              ) : camera === 'denied' ? (
                <p className="m-0 text-body">
                  Camera access was refused. Allow it in the browser, or type
                  the ID below.
                </p>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => setCamera('starting')}
                  disabled={camera === 'starting'}
                >
                  {camera === 'starting' ? 'Starting camera…' : 'Start camera'}
                </Button>
              )}
            </div>
          ) : (
            <span className="sr-only" role="status">
              Camera on. Point it at a label.
            </span>
          )}
        </div>

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
                <div className="text-label text-fg-muted">{hit.line}</div>
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

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void resolve(code)
          }}
        >
          <Field
            label="Can’t scan? Type the ID"
            className="min-w-0 flex-1"
            hint="Canonical identifiers only (SMP-, EXP-, INS-…). Aliases are not modelled yet."
          >
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="SMP-0001, EXP-0001, INS-0001…"
              autoCapitalize="characters"
              autoComplete="off"
              className="h-11 text-[16px]"
            />
          </Field>
          <Button type="submit" size="lg" disabled={!code.trim() || busy}>
            {busy ? 'Finding…' : 'Find'}
          </Button>
        </form>

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
