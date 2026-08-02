// @vitest-environment node

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  new URL('../../.github/workflows/deploy-dev.yml', import.meta.url),
  'utf8',
)

describe('development deployment workflow', () => {
  it('derives the artifact identity from the selected checkout', () => {
    expect(workflow).toContain('VERSION="$(git rev-parse HEAD)"')
    expect(workflow).not.toContain('version=${{ github.sha }}')
    expect(workflow).toContain(
      'SHEETBASE_ARTIFACT_VERSION: ${{ steps.version.outputs.version }}',
    )
    expect(workflow).toContain('git checkout --detach "$ARTIFACT_VERSION"')
  })
})
