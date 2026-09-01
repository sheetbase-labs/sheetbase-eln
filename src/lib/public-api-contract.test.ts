import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const contract = readFileSync('docs/api/public-api-contract.md', 'utf8')

function grantsFor(scope: string): string {
  const row = contract
    .split('\n')
    .find((line) => new RegExp(`^\\| \`${scope}\` +\\|`).test(line))
  expect(row, `missing contract row for ${scope}`).toBeTruthy()
  return row ?? ''
}

describe('API-01 Core scope vocabulary', () => {
  it('keeps Dataset data operations off governed schema stewardship', () => {
    const write = grantsFor('datasets:write')
    expect(write).toMatch(/Create datasets, commit rows, snapshot/)
    expect(write).toMatch(/Does \*\*not\*\* include schema stewardship/)
    expect(write).not.toMatch(/schema stewardship RPCs/)
    expect(write).not.toMatch(/create_dataset_schema/)
    expect(grantsFor('datasets:read')).toMatch(
      /Does \*\*not\*\* include Dataset Schema catalogues/,
    )
  })

  it('gives Dataset Schema and other catalogues a distinct schema:* family', () => {
    expect(grantsFor('schema:read')).toMatch(/Dataset Schema/)
    expect(grantsFor('schema:write')).toMatch(/schema\.edit/)
    expect(grantsFor('schema:publish')).toMatch(/schema\.publish/)
    expect(contract).toMatch(
      /never grant governed schema\/configuration authority/,
    )
    expect(contract).toMatch(
      /Do not[\s\S]{0,20}collapse those into `datasets:write`/,
    )
  })

  it('does not let sheets:write author Sheet Definitions', () => {
    expect(grantsFor('sheets:write')).toMatch(
      /Does \*\*not\*\* author Sheet Definitions/,
    )
    expect(grantsFor('sheets:read')).toMatch(/schema:read/)
  })

  it('does not advertise credential submit, sign, amend or revision checks', () => {
    expect(grantsFor('reviews:read')).toMatch(/Preview a submission digest/)
    expect(grantsFor('reviews:read')).toMatch(
      /Does \*\*not\*\* run revision checks/,
    )
    expect(grantsFor('reviews:write')).toMatch(
      /Does \*\*not\*\* submit, sign or amend/,
    )
    expect(grantsFor('reviews:write')).toMatch(/human-session-only/)
    expect(contract).toMatch(/stay \*\*off\*\* the credential allowlist/)
  })
})
