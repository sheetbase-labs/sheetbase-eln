import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { Icon } from '#/components/icons'
import { cn } from '#/lib/utils'
import { useWakeLock } from '#/lib/pwa/wake-lock'

import { SCAN_FORMATS, loadCodeDecoder } from './code-decoder'
import { rich, t } from '#/copy'

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

/** The viewfinder, and the button that starts (or retries) the camera. */
function CameraViewfinder({
  state,
  video,
  onStart,
}: {
  state: CameraScannerState
  video: RefObject<HTMLVideoElement | null>
  onStart: () => void
}) {
  const scanning = state === 'scanning'
  const message = STATE_MESSAGE[state]

  const retryable =
    state === 'denied' || state === 'unavailable' || state === 'error'

  const showStart = state === 'idle' || state === 'starting' || retryable

  return (
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
          {t('library.scan.cameraScanner.cameraOnPointItAt')}
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
              onClick={onStart}
            >
              {state === 'starting'
                ? t('library.scan.cameraScanner.startingCamera')
                : state === 'idle'
                  ? t('library.scan.cameraScanner.startCamera')
                  : t('common.actions.tryAgain')}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** The typed-ID fallback for a label the camera cannot read. */
function TypedCodeForm({
  value,
  onValueChange,
  busy,
  onScan,
}: {
  value: string
  onValueChange: (value: string) => void
  busy: boolean
  onScan: (code: string, source: ScanSource) => void
}) {
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = value.trim()

        if (trimmed) onScan(trimmed, 'typed')
      }}
    >
      {/* The hint sits under the row, not inside the field: inside it, the
          button lined up with the hint's bottom edge instead of the input. */}
      <div className="flex items-end gap-2">
        <Field
          label={t('library.scan.cameraScanner.cantScanTypeTheId')}
          className="min-w-0 flex-1"
        >
          <Input
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={t('library.scan.cameraScanner.smp0001Exp0001Ins')}
            autoCapitalize="characters"
            autoComplete="off"
            className="h-11"
          />
        </Field>
        <Button
          type="submit"
          size="lg"
          className="h-11"
          disabled={!value.trim() || busy}
        >
          {busy
            ? t('library.scan.cameraScanner.finding')
            : t('library.scan.cameraScanner.find')}
        </Button>
      </div>
      <p className="m-0 text-label text-fg-muted">
        {t('library.scan.cameraScanner.identifiersSmpExpInsOr')}
      </p>
    </form>
  )
}

const STATE_MESSAGE: Partial<Record<CameraScannerState, string>> = {
  'no-camera-api': t('library.scan.cameraScanner.thisDeviceCantUseThe'),
  unsupported: t('library.scan.cameraScanner.thisBrowserCantReadLabels'),
  denied: t('library.scan.cameraScanner.cameraAccessWasRefusedAllow'),
  unavailable: t('library.scan.cameraScanner.noCameraWasFoundOn'),
  error: t('library.scan.cameraScanner.theCameraCouldntBeStarted'),
}

/** Human names for the label formats, keyed by the format the decoder reports. */
interface FormatLabels {
  [format: string]: string
}

/** Human names for the label formats, used in the coverage message. */
const FORMAT_LABEL: FormatLabels = {
  qr_code: t('library.scan.cameraScanner.qrCodes'),
  data_matrix: t('library.scan.cameraScanner.dataMatrix'),
  code_128: t('library.scan.cameraScanner.code128'),
}

/** "QR codes", "Data Matrix or Code 128" — for prose about the formats. */
function formatList(formats: readonly string[]): string {
  const labels = formats.map((format) => FORMAT_LABEL[format] ?? format)

  if (labels.length < 2) return labels[0] ?? ''

  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`
}

/** The `name` a rejected `getUserMedia` promise carries, when it carries one. */
const failureNameSchema = z.object({ name: z.string() })

/** Which honest failure state a rejected `getUserMedia` maps to. */
function cameraFailureState(failureName: string): CameraScannerState {
  if (failureName === 'NotAllowedError' || failureName === 'SecurityError')
    return 'denied'

  if (
    failureName === 'NotFoundError' ||
    failureName === 'DevicesNotFoundError' ||
    failureName === 'OverconstrainedError'
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

  // react-doctor-disable-next-line react-doctor/no-set-state-after-await-in-effect -- the effect's cleanup sets `stopped`, which its control-flow analysis cannot see through a closure object; the stream and timer it starts are released by that cleanup.
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
      } catch (failure) {
        const named = failureNameSchema.safeParse(failure)
        setState(cameraFailureState(named.success ? named.data.name : ''))

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

  // Keep the screen on while the camera is reading, so it does not dim mid-scan.
  useWakeLock(scanning)

  // Formats the active decoder cannot read, so the message can name them. The
  // shipped jsQR fallback reads QR only, unlike the native detector.
  const readableFormats = new Set(decoderFormats ?? [])

  const limitedFormats = decoderFormats
    ? formats.filter((format) => !readableFormats.has(format))
    : []

  return (
    <div
      className={cn('flex flex-col gap-4', className)}
      data-camera-state={state}
    >
      <CameraViewfinder
        state={state}
        video={video}
        onStart={() => {
          setState('starting')
          setSession((n) => n + 1)
        }}
      />

      {scanning && limitedFormats.length > 0 ? (
        <p
          role="status"
          data-scan-coverage="limited"
          className="m-0 text-label text-fg-muted"
        >
          {t('library.scan.cameraScanner.fromTheCameraThisBrowser', {
            readable: formatList(
              formats.filter((format) => readableFormats.has(format)),
            ),
            limited: formatList(limitedFormats),
          })}
        </p>
      ) : null}

      {children}

      <TypedCodeForm
        value={value}
        onValueChange={onValueChange}
        busy={busy}
        onScan={onScan}
      />

      {lastScan ? (
        <p className="m-0 text-label text-fg-muted">
          {rich('library.scan.cameraScanner.lastScan', {
            lastScan,
            span: (text) => <span className="mono">{text}</span>,
          })}
        </p>
      ) : null}
    </div>
  )
}
