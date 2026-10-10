/**
 * The shipped fallback decoder for the Scan surface (LAB-05.4): jsQR, a pure
 * JavaScript QR reader. It stands in for the browser's `BarcodeDetector` where
 * that is missing, behind the `CodeDecoder` seam in `./code-decoder`.
 *
 * jsQR reads QR codes only. The native detector also covers Data Matrix and 1D
 * Code 128 labels, so this decoder advertises the narrower format set and the
 * scanner tells the person which labels must instead be typed.
 */

import decode from 'jsqr'

import type { CodeDecoder } from './code-decoder'

/** The one format jsQR can read. */
export const JSQR_FORMATS = ['qr_code'] as const

/**
 * Loader for the fallback decoder, matching `FallbackDecoderLoader` in
 * `./code-decoder`.
 *
 * Sampling draws the current video frame into an offscreen canvas and hands
 * the pixels to jsQR. A frame that is not available — no camera, no canvas 2D
 * context, or a video with no dimensions yet — yields no codes rather than an
 * error, so the scanner reports nothing instead of guessing. jsQR is called
 * with its inverted pass off because printed labels are dark-on-light.
 */
export async function loadJsqrCodeDecoder(): Promise<CodeDecoder> {
  let canvas: HTMLCanvasElement | undefined
  return {
    name: 'jsQR',
    formats: JSQR_FORMATS,
    async detect(video) {
      const width = video.videoWidth
      const height = video.videoHeight
      if (width <= 0 || height <= 0) return []
      canvas ??= document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return []
      context.drawImage(video, 0, 0, width, height)
      const image = context.getImageData(0, 0, width, height)
      const result = decode(image.data, width, height, {
        inversionAttempts: 'dontInvert',
      })
      return result?.data ? [result.data] : []
    },
  }
}
