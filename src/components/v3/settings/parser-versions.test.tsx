import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ParserVersions } from './parser-versions'
import type { ParserSettingsRow } from '#/lib/parser-settings'

afterEach(cleanup)

it('selects the exact persisted version and does not invent validation or approval', () => {
  const parser: ParserSettingsRow = {
    id: 'parser-a',
    key: 'firmware',
    name: 'Firmware export',
    format: 'tsv',
    instrument_id: null,
    instruments: null,
    parser_versions: [
      {
        id: 'version-b',
        version: 7,
        status: 'draft',
        signature: {},
        mapping: {},
        test_result: null,
        validated_at: null,
        approved_at: null,
        approved_by_user_id: null,
      },
    ],
  }
  const onSelect = vi.fn()
  render(
    <ParserVersions
      parsers={[parser]}
      selectedVersionId={null}
      onSelect={onSelect}
    />,
  )
  expect(screen.getByRole('table', { name: 'Parser versions' })).toBeTruthy()
  expect(screen.getByText('Not tested')).toBeTruthy()
  expect(screen.getByText('Not approved')).toBeTruthy()
  expect(screen.getByText('Not linked')).toBeTruthy()
  expect(screen.getByText('TSV')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Firmware export v7' }))
  expect(onSelect).toHaveBeenCalledWith(parser, parser.parser_versions[0])
})

it('renders an empty canonical catalogue without showing build-time parsers', () => {
  render(
    <ParserVersions
      parsers={[]}
      selectedVersionId={null}
      onSelect={() => {}}
    />,
  )
  expect(
    screen.getByText('No parser versions have been created in this workspace.'),
  ).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
})
