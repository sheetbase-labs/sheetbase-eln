/**
 * Stable seed identities. See docs/seeds.md.
 *
 * All seed UUIDs carry a zero prefix so seeded rows are recognisable anywhere,
 * including accidental screenshots and dumps. Range allocation:
 *
 * - `…0001`–`…00ff` minimal test fixtures (FIXTURE_*)
 * - `…0100`–`…01ff` Virus Stability demonstration data (DEMO_*)
 *
 * Tests must never assert against DEMO_* rows; demonstration data is for
 * humans. Tests create their own data or use the minimal fixtures.
 */

export const FIXTURE_USER_ID = '00000000-0000-4000-8000-000000000001'
export const FIXTURE_USER_EMAIL = 'owner@sheetbase.test'

export const FIXTURE_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002'
export const FIXTURE_WORKSPACE_SLUG = 'fixture-workspace'

export const FIXTURE_PROJECT_ID = '00000000-0000-4000-8000-000000000003'
export const FIXTURE_PROJECT_KEY = 'fixture-project'

export const DEMO_VIRUS_STABILITY_PROJECT_ID =
  '00000000-0000-4000-8000-000000000100'
export const DEMO_VIRUS_STABILITY_PROJECT_KEY = 'virus-stability'

// Virus Stability demonstration data (notebook domain, ELN-002). The demo
// reuses the fixture workspace/user so the seeded project and its experiment
// are visible to the fixture owner without a separate membership.
export const DEMO_VIRUS_STABILITY_RECORD_ID =
  '00000000-0000-4000-8000-000000000101'
export const DEMO_VIRUS_STABILITY_RECORD_IDENTIFIER = 'EXP-2025-0001'
export const DEMO_VIRUS_STABILITY_PROTOCOL_RECORD_ID =
  '00000000-0000-4000-8000-000000000102'
export const DEMO_VIRUS_STABILITY_PROTOCOL_IDENTIFIER = 'PRT-2025-0001'

// Stable block ids so the demo notebook re-seeds idempotently. 0x110–0x11f.
export const DEMO_BLOCK_IDS = {
  objective: '00000000-0000-4000-8000-000000000111',
  materials: '00000000-0000-4000-8000-000000000113',
  design: '00000000-0000-4000-8000-000000000115',
  designTable: '00000000-0000-4000-8000-000000000116',
  results: '00000000-0000-4000-8000-000000000117',
  resultsChart: '00000000-0000-4000-8000-000000000118',
  titerMetric: '00000000-0000-4000-8000-000000000119',
  checks: '00000000-0000-4000-8000-00000000011a',
  callout: '00000000-0000-4000-8000-00000000011b',
  linkedProtocol: '00000000-0000-4000-8000-00000000011c',
} as const
