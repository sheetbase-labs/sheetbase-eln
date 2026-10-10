/**
 * Code decoding for the Scan surface (LAB-05.4). The browser's
 * `BarcodeDetector` is preferred where it exists; where it does not, the
 * shipped jsQR fallback — see {@link defaultFallbackDecoderLoader} — reads QR
 * codes from the video frame. jsQR cannot read Data Matrix or 1D Code 128
 * labels, which {@link CodeDecoder.formats} lets the scanner disclose so the
 * person knows to type those IDs instead. The typed-ID path is always
 * available, whatever happens here.
 */

import { loadJsqrCodeDecoder } from './jsqr-code-decoder'

/** Label formats the Scan surface cares about: the DEC-10 2D code URL plus
 * 1D tube labels. */
export const SCAN_FORMATS = ['qr_code', 'data_matrix', 'code_128'] as const

/** A camera-frame decoder. Native `BarcodeDetector` and any future WASM
 * decoder both satisfy this interface, so the scanner never knows which one it
 * is using. */
export interface CodeDecoder {
  /** Shown in honest-state messages and used to tell implementations apart. */
  readonly name: string
  /** Formats this decoder can actually read, when that is narrower than the
   * requested set; the scanner warns about the rest. Omitted means "as
   * requested". */
  readonly formats?: readonly string[]
  /** Read the codes visible in the current frame of a playing video element. */
  detect: (video: HTMLVideoElement) => Promise<string[]>
}

interface DetectedCode {
  rawValue: string
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => {
  detect: (source: HTMLVideoElement) => Promise<DetectedCode[]>
}

/** The slice of `window` the decoder resolution depends on. */
export interface DetectorHost {
  BarcodeDetector?: BarcodeDetectorCtor
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor
  }
}

/**
 * Loader for a non-native decoder. Returning `null` (or throwing) means "no
 * decoder available" and the caller falls back to typing the ID.
 */
export type FallbackDecoderLoader = () => Promise<CodeDecoder | null>

/** The decoder the app ships for browsers without `BarcodeDetector`: jsQR,
 * which reads QR codes only. */
export const defaultFallbackDecoderLoader: FallbackDecoderLoader =
  loadJsqrCodeDecoder

/** An override for {@link defaultFallbackDecoderLoader}, set by
 * {@link setFallbackDecoderLoader}. `null` means "use the shipped one". */
let fallbackDecoderLoader: FallbackDecoderLoader | null = null

/** Replace the shipped jsQR fallback — used by tests, or by an app that ships
 * its own decoder. Passing `null` restores the shipped one; a loader that
 * resolves to `null` disables the fallback entirely. */
export function setFallbackDecoderLoader(
  loader: FallbackDecoderLoader | null,
): void {
  fallbackDecoderLoader = loader
}

/** Wrap the browser's `BarcodeDetector` in {@link CodeDecoder}, or `null` when
 * the browser does not provide it. */
export function nativeCodeDecoder(
  host: DetectorHost | undefined = typeof window === 'undefined'
    ? undefined
    : window,
  formats: readonly string[] = SCAN_FORMATS,
): CodeDecoder | null {
  const Ctor = host?.BarcodeDetector
  if (!Ctor) return null
  const detector = new Ctor({ formats: [...formats] })
  return {
    name: 'BarcodeDetector',
    formats: [...formats],
    async detect(video) {
      const codes = await detector.detect(video)
      return codes.map((code) => code.rawValue)
    },
  }
}

/** The decoder to use for this session: the browser's own, else the shipped or
 * overridden fallback, else `null` meaning "no decoder — type the ID
 * instead". */
export async function loadCodeDecoder(
  host: DetectorHost | undefined = typeof window === 'undefined'
    ? undefined
    : window,
  formats: readonly string[] = SCAN_FORMATS,
): Promise<CodeDecoder | null> {
  const native = nativeCodeDecoder(host, formats)
  if (native) return native
  try {
    return await (fallbackDecoderLoader ?? defaultFallbackDecoderLoader)()
  } catch {
    // A broken fallback must never block the typed path.
    return null
  }
}
