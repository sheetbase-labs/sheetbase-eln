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
