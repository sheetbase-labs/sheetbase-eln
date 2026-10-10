/**
 * Code decoding for the Scan surface (LAB-05.4). The browser's
 * `BarcodeDetector` is preferred where it exists; anything else is a fallback
 * behind {@link CodeDecoder}. The repository deliberately ships no QR/WASM
 * decoder dependency, so by default there is no fallback and callers must use
 * the typed-ID path — see {@link setFallbackDecoderLoader} for the seam where a
 * WASM implementation (e.g. `zxing-wasm`) would plug in.
 */

/** Label formats the Scan surface cares about: the DEC-10 2D code URL plus
 * 1D tube labels. */
export const SCAN_FORMATS = ['qr_code', 'data_matrix', 'code_128'] as const

/** A camera-frame decoder. Native `BarcodeDetector` and any future WASM
 * decoder both satisfy this interface, so the scanner never knows which one it
 * is using. */
export interface CodeDecoder {
  /** Shown in honest-state messages and used to tell implementations apart. */
  readonly name: string
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
 * Loader for a non-native decoder. The repository ships none, so returning
 * `null` (or throwing) means "no decoder available" and the caller falls back
 * to typing the ID.
 */
export type FallbackDecoderLoader = () => Promise<CodeDecoder | null>

let fallbackDecoderLoader: FallbackDecoderLoader | null = null

/** Register (or clear) the WASM decoder used when the browser has no
 * `BarcodeDetector`. Nothing registers one by default. */
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
    async detect(video) {
      const codes = await detector.detect(video)
      return codes.map((code) => code.rawValue)
    },
  }
}

/** The decoder to use for this session: the browser's own, else the registered
 * fallback, else `null` meaning "no decoder — type the ID instead". */
export async function loadCodeDecoder(
  host: DetectorHost | undefined = typeof window === 'undefined'
    ? undefined
    : window,
  formats: readonly string[] = SCAN_FORMATS,
): Promise<CodeDecoder | null> {
  const native = nativeCodeDecoder(host, formats)
  if (native) return native
  if (!fallbackDecoderLoader) return null
  try {
    return await fallbackDecoderLoader()
  } catch {
    // A missing or broken WASM decoder must never block the typed fallback.
    return null
  }
}
