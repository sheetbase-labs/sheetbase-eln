/**
 * EXT-02 sample extension tests: the sample manifest parses, resolves
 * through the registry only when enabled, installs through the public
 * client surface, and the panel renders from a host-injected loader.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../../data-client'
import { parseExtensionManifest } from '../manifest'
import { resolveExtensionContributions } from '../registry'
import { installSampleExtension } from './install'
import { SAMPLE_EXTENSION_KEY, SAMPLE_EXTENSION_MANIFEST } from './manifest'
import { SampleExtensionPanel } from './panel'

afterEach(() => cleanup())

describe('sample extension manifest', () => {
  it('parses under EXT-01 validation', () => {
    const manifest = parseExtensionManifest({ ...SAMPLE_EXTENSION_MANIFEST })
    expect(manifest.contributions['object-actions']?.map((d) => d.id)).toEqual([
      'open-panel',
    ])
    expect(manifest.contributions.panels?.map((d) => d.id)).toEqual([
      'sample-panel',
    ])
    expect(manifest.contributions.commands?.map((d) => d.id)).toEqual([
      'sample-overview',
    ])
  })

  it('resolves all three points when enabled, nothing when disabled', () => {
    const enabled = resolveExtensionContributions(
      [
        {
          id: 'ext',
          key: SAMPLE_EXTENSION_KEY,
          status: 'enabled',
          manifest: SAMPLE_EXTENSION_MANIFEST,
        },
      ],
      'member',
    )
    expect(enabled.objectActions).toHaveLength(1)
    expect(enabled.panels).toHaveLength(1)
    expect(enabled.commands).toHaveLength(1)

    const disabled = resolveExtensionContributions(
      [
        {
          id: 'ext',
          key: SAMPLE_EXTENSION_KEY,
          status: 'disabled',
          manifest: SAMPLE_EXTENSION_MANIFEST,
        },
      ],
      'member',
    )
    expect(disabled).toEqual({ objectActions: [], panels: [], commands: [] })
  })

  it('installs and enables through the public client surface', async () => {
    const rpc = vi.fn(async () => ({ id: 'ext-1' }))
    await installSampleExtension({ rpc } as unknown as DataClient, 'ws-1')
    expect(rpc).toHaveBeenCalledWith(
      'install_extension',
      expect.objectContaining({
        p_workspace_id: 'ws-1',
        p_key: SAMPLE_EXTENSION_KEY,
      }),
    )
    expect(rpc).toHaveBeenCalledWith(
      'enable_extension',
      expect.objectContaining({
        p_workspace_id: 'ws-1',
        p_extension_id: 'ext-1',
      }),
    )
  })
})

describe('SampleExtensionPanel', () => {
  it('renders the host-loaded summary', async () => {
    render(
      <SampleExtensionPanel
        loadSummary={async () => ({
          heading: 'Lentivector stability',
          subheading: 'via public contract reads',
          rows: [
            { label: 'Type', value: 'Experiment' },
            { label: 'Activity', value: '4 events' },
          ],
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('Lentivector stability')).toBeTruthy()
    })
    expect(screen.getByText('Activity')).toBeTruthy()
    expect(screen.getByText('4 events')).toBeTruthy()
  })

  it('recovers honestly from loader failure', async () => {
    const user = userEvent.setup()
    let calls = 0
    render(
      <SampleExtensionPanel
        loadSummary={async () => {
          calls += 1
          if (calls === 1) throw new Error('offline')
          return { heading: 'Recovered', rows: [] }
        }}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('offline')).toBeTruthy()
    })
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(screen.getByText('Recovered')).toBeTruthy()
    })
  })
})
