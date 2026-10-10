import { useState } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import QRCode from 'qrcode'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CameraScanner } from './camera-scanner'
import type { ScanSource } from './camera-scanner'
import { setFallbackDecoderLoader } from './code-decoder'
import type { CodeDecoder } from './code-decoder'

/** Controlled harness, standing in for the Scan page. */
function Harness({
  onScan,
}: {
  onScan: (code: string, source: ScanSource) => void
}) {
  const [value, setValue] = useState('')
  return (
    <CameraScanner value={value} onValueChange={setValue} onScan={onScan} />
  )
}

/** jsdom has no MediaStream; the stub supplies the only member the scanner
 * touches, track stopping. */
function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
}

function setMediaDevices(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(getUserMedia) },
  })
}

function setBarcodeDetector(values: string[]) {
  class Detector {
    async detect() {
      return values.map((rawValue) => ({ rawValue }))
    }
  }
  Object.defineProperty(window, 'BarcodeDetector', {
    configurable: true,
    writable: true,
    value: Detector,
  })
}

/** One RGBA video frame, the shape the jsQR decoder samples from a canvas. */
interface Frame {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** A camera frame holding a real, scannable QR code for `text`: the modules
 * rendered dark-on-light, scaled up with a quiet zone. */
function qrFrame(text: string): Frame {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const size = modules.size
  const scale = 8
  const quiet = 4
  const width = (size + quiet * 2) * scale
  const data = new Uint8ClampedArray(width * width * 4).fill(255)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!modules.data[y * size + x]) continue
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const offset =
            (((y + quiet) * scale + dy) * width + (x + quiet) * scale + dx) * 4
          data[offset] = 0
          data[offset + 1] = 0
          data[offset + 2] = 0
        }
      }
    }
  }
  return { data, width, height: width }
}

/** A frame with no readable code: deterministic high-frequency colour noise. */
function noiseFrame(size = 64): Frame {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < data.length; i += 4) {
    const value = (i * 37) % 256
    data[i] = value
    data[i + 1] = (value * 3) % 256
    data[i + 2] = (value * 7) % 256
    data[i + 3] = 255
  }
  return { data, width: size, height: size }
}

/** Present `frame` as the video's current pixels. `null` means the frame is
 * not available yet (the video still reports zero dimensions). */
function setVideoFrame(frame: Frame | null): void {
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    get: () => frame?.width ?? 0,
  })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    get: () => frame?.height ?? 0,
  })
  const context = frame
    ? {
        drawImage: vi.fn(),
        getImageData: () => ({
          data: frame.data,
          width: frame.width,
          height: frame.height,
        }),
      }
    : null
  // jsdom ships no canvas; the stub carries only what the decoder reads.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => context) as never,
  )
}

const originalPlay = HTMLMediaElement.prototype.play
const originalVideoSize = {
  width: Object.getOwnPropertyDescriptor(
    HTMLVideoElement.prototype,
    'videoWidth',
  ),
  height: Object.getOwnPropertyDescriptor(
    HTMLVideoElement.prototype,
    'videoHeight',
  ),
}

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  HTMLMediaElement.prototype.play = originalPlay
  if (originalVideoSize.width) {
    Object.defineProperty(
      HTMLVideoElement.prototype,
      'videoWidth',
      originalVideoSize.width,
    )
  }
  if (originalVideoSize.height) {
    Object.defineProperty(
      HTMLVideoElement.prototype,
      'videoHeight',
      originalVideoSize.height,
    )
  }
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'BarcodeDetector')
  Reflect.deleteProperty(navigator, 'mediaDevices')
  setFallbackDecoderLoader(null)
  vi.useRealTimers()
})

describe('CameraScanner', () => {
  it('reports a typed ID when the browser has no BarcodeDetector', () => {
    expect('BarcodeDetector' in window).toBe(false)
    const onScan = vi.fn()
    render(<Harness onScan={onScan} />)

    fireEvent.change(screen.getByLabelText(/Type the ID/), {
      target: { value: 'SMP-0001' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))

    expect(onScan).toHaveBeenCalledWith('SMP-0001', 'typed')
  })

  it('reports a code read from the camera and keeps the last scan', async () => {
    vi.useFakeTimers()
    setBarcodeDetector(['SMP-2231'])
    setMediaDevices(async () => fakeStream())
    const onScan = vi.fn()
    render(<Harness onScan={onScan} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }))
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(onScan).toHaveBeenCalledWith('SMP-2231', 'camera')
    // Holding the same label in frame must not resolve it repeatedly.
    expect(onScan).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Camera on/)).toBeTruthy()
    expect(screen.getByText('SMP-2231')).toBeTruthy()
  })

  it('uses a registered fallback decoder when BarcodeDetector is absent', async () => {
    vi.useFakeTimers()
    setMediaDevices(async () => fakeStream())
    const wasm: CodeDecoder = {
      name: 'zxing-wasm',
      detect: async () => ['QR-2231'],
    }
    setFallbackDecoderLoader(async () => wasm)
    const onScan = vi.fn()
    render(<Harness onScan={onScan} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }))
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(onScan).toHaveBeenCalledWith('QR-2231', 'camera')
  })

  it('points at the typed ID when no decoder for the label formats exists', async () => {
    setMediaDevices(async () => fakeStream())
    // A fallback that resolves to nothing stands in for a browser with neither
    // BarcodeDetector nor a working decoder.
    setFallbackDecoderLoader(async () => null)
    render(<Harness onScan={vi.fn()} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }))
    })

    expect(screen.getByText(/can’t read labels from the camera/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByLabelText(/Type the ID/)).toBeTruthy()
  })

  it('reports a refused camera permission honestly', async () => {
    setBarcodeDetector([])
    setMediaDevices(async () => {
      throw Object.assign(new Error('Permission denied'), {
        name: 'NotAllowedError',
      })
    })
    render(<Harness onScan={vi.fn()} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }))
    })

    expect(screen.getByText(/Camera access was refused/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('reports when the device has no camera API', async () => {
    render(<Harness onScan={vi.fn()} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }))
    })

    expect(screen.getByText(/can’t use the camera/)).toBeTruthy()
  })

  it('reads a QR from the camera with the shipped jsqr fallback', async () => {
    vi.useFakeTimers()
    setMediaDevices(async () => fakeStream())
    setVideoFrame(qrFrame('SMP-2231'))
    const onScan = vi.fn()
    render(<Harness onScan={onScan} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }))
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(onScan).toHaveBeenCalledWith('SMP-2231', 'camera')
    // Holding the same label in frame must not resolve it repeatedly.
    expect(onScan).toHaveBeenCalledTimes(1)
    expect(screen.getByText('SMP-2231')).toBeTruthy()
  })

  it('says the jsqr fallback reads QR codes only and keeps the typed path', async () => {
    vi.useFakeTimers()
    setMediaDevices(async () => fakeStream())
    setVideoFrame(noiseFrame())
    render(<Harness onScan={vi.fn()} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }))
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(screen.getByText(/can read QR codes only/)).toBeTruthy()
    expect(
      screen.getByText(/Type a Data Matrix or Code 128 ID below/),
    ).toBeTruthy()
    expect(screen.getByLabelText(/Type the ID/)).toBeTruthy()
  })

  it('reports nothing when the frame holds no readable code', async () => {
    vi.useFakeTimers()
    setMediaDevices(async () => fakeStream())
    setVideoFrame(noiseFrame())
    const onScan = vi.fn()
    render(<Harness onScan={onScan} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }))
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(onScan).not.toHaveBeenCalled()
    expect(screen.getByText(/Camera on/)).toBeTruthy()
  })

  it('reads nothing until the video has a frame', async () => {
    vi.useFakeTimers()
    setMediaDevices(async () => fakeStream())
    setVideoFrame(null)
    const onScan = vi.fn()
    render(<Harness onScan={onScan} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }))
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(onScan).not.toHaveBeenCalled()
  })

  it('accepts a typed ID while the jsqr fallback scans', async () => {
    vi.useFakeTimers()
    setMediaDevices(async () => fakeStream())
    setVideoFrame(noiseFrame())
    const onScan = vi.fn()
    render(<Harness onScan={onScan} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }))
      await vi.advanceTimersByTimeAsync(300)
    })

    fireEvent.change(screen.getByLabelText(/Type the ID/), {
      target: { value: 'SMP-0001' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))

    expect(onScan).toHaveBeenCalledWith('SMP-0001', 'typed')
  })
})
