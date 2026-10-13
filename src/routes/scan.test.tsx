import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './scan'

const scanData = vi.hoisted(() => ({
  resolveScanCode: vi.fn(),
  scanTargetHref: vi.fn(() => ({
    to: '/samples/$sampleId',
    params: { sampleId: 's-1' },
  })),
  scanTargetActionLabel: vi.fn(() => 'Open sample'),
}))

vi.mock('#/components/v3/scan/scan-data', () => scanData)

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    options: config,
  }),
  redirect: (options: unknown) => options,
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to?: string
    params?: Record<string, string>
    children: React.ReactNode
  } & Record<string, unknown>) => {
    let href = typeof to === 'string' ? to : '#'
    if (params) {
      for (const [key, value] of Object.entries(params))
        href = href.replace(`$${key}`, encodeURIComponent(String(value)))
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

const ScanRoute = Route.options.component as React.ComponentType

const originalPlay = HTMLMediaElement.prototype.play

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
  HTMLMediaElement.prototype.play = originalPlay
  Reflect.deleteProperty(window, 'BarcodeDetector')
  Reflect.deleteProperty(navigator, 'mediaDevices')
})

describe('Scan route', () => {
  it('resolves a typed identifier and shows the record', async () => {
    scanData.resolveScanCode.mockResolvedValue({
      found: true,
      code: 'SMP-2231',
      suggestions: [],
      hit: {
        id: 's-1',
        identifier: 'SMP-2231',
        title: 'Harvest lot HL-0934',
        kind: 'sample',
        status: { tone: 'ok', label: 'Released' },
        line: 'Sample · Cell harvest',
      },
    })
    render(<ScanRoute />)

    await userEvent.type(screen.getByLabelText(/Type the ID/), 'SMP-2231')
    await userEvent.click(screen.getByRole('button', { name: 'Find' }))

    await waitFor(() =>
      expect(
        within(
          screen.getByRole('region', { name: 'Scanned record' }),
        ).getByText('Harvest lot HL-0934'),
      ).toBeTruthy(),
    )
    expect(scanData.resolveScanCode).toHaveBeenCalledWith('SMP-2231')
    expect(screen.getByText('Open sample')).toBeTruthy()
    expect(screen.getByText('Recent scans')).toBeTruthy()
  })

  it('offers suggestions when the identifier is unknown', async () => {
    scanData.resolveScanCode.mockResolvedValue({
      found: false,
      code: 'SMP-9999',
      suggestions: [
        {
          id: 's-2',
          identifier: 'SMP-0002',
          title: 'Harvest lot HL-0002',
          kind: 'sample',
          status: { tone: 'ok', label: 'Released' },
          line: 'Sample',
        },
      ],
    })
    render(<ScanRoute />)

    await userEvent.type(screen.getByLabelText(/Type the ID/), 'SMP-9999')
    await userEvent.click(screen.getByRole('button', { name: 'Find' }))

    await waitFor(() =>
      expect(screen.getByText(/No record with ID SMP-9999/)).toBeTruthy(),
    )

    scanData.resolveScanCode.mockResolvedValue({
      found: true,
      code: 'SMP-0002',
      suggestions: [],
      hit: {
        id: 's-2',
        identifier: 'SMP-0002',
        title: 'Harvest lot HL-0002',
        kind: 'sample',
        status: { tone: 'ok', label: 'Released' },
        line: 'Sample',
      },
    })
    await userEvent.click(screen.getByRole('button', { name: 'SMP-0002' }))

    await waitFor(() =>
      expect(
        within(
          screen.getByRole('region', { name: 'Scanned record' }),
        ).getByText('Harvest lot HL-0002'),
      ).toBeTruthy(),
    )
    expect(scanData.resolveScanCode).toHaveBeenLastCalledWith('SMP-0002')
  })

  it('resolves a code read from the camera', async () => {
    vi.useFakeTimers()
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
    class Detector {
      async detect() {
        return [{ rawValue: 'SMP-2231' }]
      }
    }
    Object.defineProperty(window, 'BarcodeDetector', {
      configurable: true,
      writable: true,
      value: Detector,
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        // jsdom ships no MediaStream; the scanner only stops the tracks.
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn() }],
        })),
      },
    })
    scanData.resolveScanCode.mockResolvedValue({
      found: true,
      code: 'SMP-2231',
      suggestions: [],
      hit: {
        id: 's-1',
        identifier: 'SMP-2231',
        title: 'Harvest lot HL-0934',
        kind: 'sample',
        status: { tone: 'ok', label: 'Released' },
        line: 'Sample',
      },
    })
    render(<ScanRoute />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }))
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(scanData.resolveScanCode).toHaveBeenCalledWith('SMP-2231')
    expect(
      within(screen.getByRole('region', { name: 'Scanned record' })).getByText(
        'Harvest lot HL-0934',
      ),
    ).toBeTruthy()
  })

  it('reports a lookup that fails instead of stopping with nothing on screen', async () => {
    scanData.resolveScanCode.mockRejectedValue(
      new Error('The lookup service is unavailable.'),
    )
    render(<ScanRoute />)

    await userEvent.type(screen.getByLabelText(/Type the ID/), 'SMP-2231')
    await userEvent.click(screen.getByRole('button', { name: 'Find' }))

    await waitFor(() =>
      expect(
        screen.getByText('The lookup service is unavailable.'),
      ).toBeTruthy(),
    )
    expect(screen.queryByRole('region', { name: 'Scanned record' })).toBeNull()
  })
})
