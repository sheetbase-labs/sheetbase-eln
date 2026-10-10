import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Icon } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

import { SCAN_FORMATS, loadCodeDecoder } from './code-decoder'

/**
 * Camera scanning for the Scan surface (LAB-05.4 / MOB-02). Mount it where a
 * page needs a code read from the device camera; it reports every code it reads
 * through `onScan` and always offers the typed-ID path. The browser's
 * `BarcodeDetector` is used where available; where it is not, the shipped jsQR
 * fallback reads QR codes from the video frame. jsQR cannot read Data Matrix or
 * 1D Code 128 labels, so the component says which labels must be typed instead
 * — see `./code-decoder` for the decoder resolution.
 */
export type CameraScannerState =
  /** Camera off; waiting for the person to start it. */
  | 'idle'
  | 'starting'
  /** Camera on and reading frames. */
  | 'scanning'
  /** The browser/device exposes no camera capture at all. */
  | 'no-camera-api'
  /** No decoder for the label formats is available. */
  | 'unsupported'
  | 'denied'
  | 'unavailable'
  | 'error'

/** Where a reported code came from. */
export type ScanSource = 'camera' | 'typed'

export interface CameraScannerProps {
  /** Receives a raw identifier read from the camera or typed by the person. */
  onScan: (code: string, source: ScanSource) => void
  /** Controlled value of the typed-ID fallback. */
  value: string
  onValueChange: (value: string) => void
  /** Disables the typed submit while the caller is resolving a code. */
  busy?: boolean
  /** Formats requested from the decoder. */
  formats?: readonly string[]
  /** Milliseconds between camera frames. */
  intervalMs?: number
  /** Rendered between the viewfinder and the typed-ID fallback — the caller's
   * result panel, matching the PhoneScan surface. */
  children?: ReactNode
  className?: string
}

const STATE_MESSAGE: Partial<Record<CameraScannerState, string>> = {
  'no-camera-api': 'This device can’t use the camera. Type the ID below.',
  unsupported:
    'This browser can’t read labels from the camera. Type the ID below.',
  denied:
    'Camera access was refused. Allow it in the browser, or type the ID below.',
  unavailable: 'No camera was found on this device. Type the ID below.',
  error: 'The camera couldn’t be started. Type the ID below.',
}

/** Human names for the label formats, used in the coverage message. */
const FORMAT_LABEL: Record<string, string> = {
  qr_code: 'QR codes',
  data_matrix: 'Data Matrix',
  code_128: 'Code 128',
}

/** "QR codes", "Data Matrix or Code 128" — for prose about the formats. */
function formatList(formats: readonly string[]): string {
  const labels = formats.map((format) => FORMAT_LABEL[format] ?? format)
  if (labels.length < 2) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`
}

/** Which honest failure state a rejected `getUserMedia` maps to. */
function cameraFailureState(error: unknown): CameraScannerState {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String(error.name)
      : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (
    name === 'NotFoundError' ||
    name === 'DevicesNotFoundError' ||
    name === 'OverconstrainedError'
  ) {
    return 'unavailable'
  }
  return 'error'
}

export function CameraScanner({
  onScan,
  value,
  onValueChange,
  busy = false,
  formats = SCAN_FORMATS,
  intervalMs = 250,
  children,
  className,
}: CameraScannerProps) {
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<CameraScannerState>('idle')
  const [lastScan, setLastScan] = useState<string | null>(null)
  // Formats the active decoder can read; `null` until a session loads one, or
  // when the decoder reads everything requested.
  const [decoderFormats, setDecoderFormats] = useState<
    readonly string[] | null
  >(null)
  // Bumped by "Start camera"; the session effect is keyed on it so the state
  // changes a session makes never restart or cancel the scanning loop.
  const [session, setSession] = useState(0)

  const latest = useRef({ onScan, onValueChange, formats })
  useEffect(() => {
    latest.current = { onScan, onValueChange, formats }
  }, [onScan, onValueChange, formats])

  useEffect(() => {
    if (session === 0) return
    const stopped = { current: false }
    let stream: MediaStream | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms)
      })

    void (async () => {
      const mediaDevices =
        typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
      if (!mediaDevices?.getUserMedia) {
        setState('no-camera-api')
        return
      }
      const decoder = await loadCodeDecoder(window, latest.current.formats)
      if (!decoder) {
        setState('unsupported')
        return
      }
      setDecoderFormats(decoder.formats ?? null)
      try {
        stream = await mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
      } catch (error) {
        setState(cameraFailureState(error))
        return
      }
      if (stopped.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const element = video.current
      if (!element) return
      element.srcObject = stream
      // Autoplay can be refused on some browsers; the label is still readable
      // in the browsers we target, so a play() failure is not a camera failure.
      await element.play().catch(() => undefined)
      setState('scanning')

      // Re-report only when the code in frame changes, so holding a label
      // steady does not resolve it several times a second.
      let reported: string | null = null
      // `stopped` is set by the unmount cleanup below; the rule's control-flow
      // analysis cannot see that assignment, so it falsely narrows it to false.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (!stopped.current) {
        const codes = await decoder.detect(element).catch(() => [])
        const code =
          codes
            .map((candidate) => candidate.trim())
            .find((c) => c.length > 0) ?? null
        if (code === null) reported = null
        else if (code !== reported) {
          reported = code
          latest.current.onValueChange(code)
          setLastScan(code)
          latest.current.onScan(code, 'camera')
        }
        await sleep(intervalMs)
      }
    })()

    return () => {
      stopped.current = true
      clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [session, intervalMs])

  const scanning = state === 'scanning'
  const message = STATE_MESSAGE[state]
  const retryable =
    state === 'denied' || state === 'unavailable' || state === 'error'
  const showStart = state === 'idle' || state === 'starting' || retryable
  // Formats the active decoder cannot read, so the message can name them. The
  // shipped jsQR fallback reads QR only, unlike the native detector.
  const limitedFormats = decoderFormats
    ? formats.filter((format) => !decoderFormats.includes(format))
    : []

  return (
    <div
      className={cn('flex flex-col gap-4', className)}
      data-camera-state={state}
    >
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-inverse-bg text-inverse-text">
        <video
          ref={video}
          muted
          playsInline
          className={
            scanning ? 'absolute inset-0 size-full object-cover' : 'hidden'
          }
        />
        <div
          aria-hidden="true"
          className="absolute h-[55%] w-[70%] rounded-2xl border-[3px] border-primary"
        />
        {scanning ? (
          <span className="sr-only" role="status">
            Camera on. Point it at a label.
          </span>
        ) : (
          <div className="relative flex flex-col items-center gap-3 px-6 text-center">
            <Icon name="scan" size={28} />
            {message ? (
              <p className="m-0 text-body" role="status">
                {message}
              </p>
            ) : null}
            {showStart ? (
              <Button
                variant="primary"
                size="lg"
                disabled={state === 'starting'}
                onClick={() => {
                  setState('starting')
                  setSession((n) => n + 1)
                }}
              >
                {state === 'starting'
                  ? 'Starting camera…'
                  : state === 'idle'
                    ? 'Start camera'
                    : 'Try again'}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {scanning && limitedFormats.length > 0 ? (
        <p
          role="status"
          data-scan-coverage="limited"
          className="m-0 text-label text-fg-muted"
        >
          From the camera this browser can read{' '}
          {formatList(formats.filter((f) => !limitedFormats.includes(f)))} only.
          Type a {formatList(limitedFormats)} ID below.
        </p>
      ) : null}

      {children}

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = value.trim()
          if (trimmed) onScan(trimmed, 'typed')
        }}
      >
        <Field
          label="Can’t scan? Type the ID"
          className="min-w-0 flex-1"
          hint="Identifiers (SMP-, EXP-, INS-…) or an alias such as a harvest lot."
        >
          <Input
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder="SMP-0001, EXP-0001, INS-0001…"
            autoCapitalize="characters"
            autoComplete="off"
            className="h-11 text-[16px]"
          />
        </Field>
        <Button type="submit" size="lg" disabled={!value.trim() || busy}>
          {busy ? 'Finding…' : 'Find'}
        </Button>
      </form>

      {lastScan ? (
        <p className="m-0 text-label text-fg-muted">
          Last scan <span className="mono">{lastScan}</span>
        </p>
      ) : null}
    </div>
  )
}
