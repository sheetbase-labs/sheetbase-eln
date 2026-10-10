import { useState } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

const originalPlay = HTMLMediaElement.prototype.play

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  HTMLMediaElement.prototype.play = originalPlay
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
})
