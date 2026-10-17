import type { ComparisonControl } from './types'

/**
 * The fixed behavioural checklist (ADR-0055 decision 5). It is fixed on
 * purpose: the comparison is only worth recording if the same questions are
 * asked of every pair, so a new pair cannot narrow the questions to the ones
 * its candidate happens to pass.
 *
 * Each item names the control classes it needs. A pair declares what its
 * components actually have; an item whose control is absent is recorded as not
 * applicable, which is a recorded result, not a skipped check.
 *
 * `evidence` says how the item was answered:
 *
 * - `automated` — a test in this repository answers it. `ref` names the test
 *   file and, where useful, the case.
 * - `manual` — a person runs it in the harness route and the verdict, with its
 *   observation, is written into the comparison record.
 */

export const CHECKLIST_AREAS = [
  'keyboard',
  'mouse',
  'state',
  'density',
] as const
export type ChecklistArea = (typeof CHECKLIST_AREAS)[number]

export interface ChecklistItem {
  readonly id: string
  readonly area: ChecklistArea
  readonly instruction: string
  /** Control classes this item needs; empty means it always applies. */
  readonly requires: readonly ComparisonControl[]
  readonly evidence: 'automated' | 'manual'
  /** Where the automated answer lives, for `automated` items. */
  readonly ref?: string
}

export const COMPARISON_CHECKLIST: readonly ChecklistItem[] = Object.freeze([
  {
    id: 'keyboard-tab',
    area: 'keyboard',
    instruction:
      'Tab reaches every control in the column, in DOM order, and every focused control draws a visible focus indicator.',
    requires: [],
    evidence: 'automated',
    ref: 'tests/browser/component-compare.test.ts — keyboard: reaches every control by Tab, with a visible focus indicator',
  },
  {
    id: 'keyboard-navigate',
    area: 'keyboard',
    instruction:
      'Move between the parts of the widget with the arrow keys its pattern calls for, and see the part the widget announces as current follow the focused part.',
    requires: ['navigate'],
    evidence: 'manual',
  },
  {
    id: 'keyboard-reorder',
    area: 'keyboard',
    instruction:
      'Move a row to another position with the keyboard alone and see the new order reflected.',
    requires: ['reorder'],
    evidence: 'automated',
    ref: 'tests/browser/component-compare.test.ts — keyboard: reorders by keyboard in both columns',
  },
  {
    id: 'keyboard-sort',
    area: 'keyboard',
    instruction: 'Change the sort column and direction without a pointer.',
    requires: ['sort'],
    evidence: 'manual',
  },
  {
    id: 'keyboard-filter',
    area: 'keyboard',
    instruction: 'Apply a filter, then clear it, without a pointer.',
    requires: ['filter'],
    evidence: 'manual',
  },
  {
    id: 'keyboard-select',
    area: 'keyboard',
    instruction: 'Select a row without a pointer, and reach the selection.',
    requires: ['select'],
    evidence: 'manual',
  },
  {
    id: 'keyboard-picker',
    area: 'keyboard',
    instruction:
      'Reach the picker by Tab, change the chosen option with the arrow keys and with typeahead, and reach an option inside a group without a pointer.',
    requires: ['picker'],
    evidence: 'automated',
    ref: 'tests/browser/component-compare.test.ts — keyboard: changes the option without a pointer, in both columns',
  },
  {
    id: 'keyboard-pagination',
    area: 'keyboard',
    instruction: 'Move to the next and previous page without a pointer.',
    requires: ['pagination'],
    evidence: 'manual',
  },
  {
    id: 'mouse-reorder',
    area: 'mouse',
    instruction:
      'Drag a row by its handle and drop it at a new position; the order changes once, at drop.',
    requires: ['reorder'],
    evidence: 'automated',
    ref: 'tests/browser/component-compare.test.ts — mouse: reorders by pointer drag in both columns',
  },
  {
    id: 'mouse-sort',
    area: 'mouse',
    instruction: 'Sort by a column header, both directions.',
    requires: ['sort'],
    evidence: 'manual',
  },
  {
    id: 'mouse-filter',
    area: 'mouse',
    instruction: 'Filter by the column control, then clear it.',
    requires: ['filter'],
    evidence: 'manual',
  },
  {
    id: 'mouse-select',
    area: 'mouse',
    instruction: 'Select a row, and select a second row.',
    requires: ['select'],
    evidence: 'manual',
  },
  {
    id: 'mouse-picker',
    area: 'mouse',
    instruction:
      'Change the chosen option with the pointer alone, choosing an option inside a group and leaving the disabled option alone.',
    requires: ['picker'],
    evidence: 'manual',
  },
  {
    id: 'mouse-resize',
    area: 'mouse',
    instruction: 'Resize a column and keep the resize after a re-render.',
    requires: ['resize'],
    evidence: 'manual',
  },
  {
    id: 'state-empty',
    area: 'state',
    instruction:
      'The 0-row fixture shows an empty state that is announced, and the column keeps its controls reachable.',
    requires: [],
    evidence: 'automated',
    ref: 'tests/browser/component-compare.test.ts — states: says "no rows" and keeps its controls for the empty fixture',
  },
  {
    id: 'state-loading',
    area: 'state',
    instruction:
      'In the loading state the column reserves its space and announces itself as busy.',
    requires: [],
    evidence: 'automated',
    ref: 'tests/browser/component-compare.test.ts — states: announces loading',
  },
  {
    id: 'state-error',
    area: 'state',
    instruction:
      'In the error state the column reports the failure, offers a retry, and keeps the rest of the screen usable.',
    requires: [],
    evidence: 'automated',
    ref: 'tests/browser/component-compare.test.ts — states: reports an error and returns to ready through the retry',
  },
  {
    id: 'state-restricted',
    area: 'state',
    instruction:
      'With permission restricted, reordering and editing controls are disabled and the reason is reachable by keyboard, not by hover alone.',
    requires: [],
    evidence: 'automated',
    ref: 'tests/browser/component-compare.test.ts — states: refuses reordering and states why when permission is restricted',
  },
  {
    id: 'state-dark',
    area: 'state',
    instruction:
      'Dark theme: every element the component renders still has a token-bound colour; nothing is left on a light-only value.',
    requires: [],
    evidence: 'automated',
    ref: 'tests/browser/component-compare.test.ts — axe in both themes, and appearance evidence: screenshot of each column per theme',
  },
  {
    id: 'density-1440',
    area: 'density',
    instruction:
      'At 1440x900: no horizontal page overflow, no control clipped, and long names do not overlap their neighbours.',
    requires: [],
    evidence: 'automated',
    ref: 'tests/browser/component-compare.test.ts — density and overflow: holds at desktop 1440x900',
  },
  {
    id: 'density-390',
    area: 'density',
    instruction:
      'At 390x844: the same, with no control below 44px or off-screen, and the column scrolls vertically only.',
    requires: [],
    evidence: 'automated',
    ref: 'tests/browser/component-compare.test.ts — density and overflow: holds at phone 390x844',
  },
])

/** Automated evidence outside the checklist: axe and the photographs. */
export const CHECKLIST_EVIDENCE = Object.freeze({
  axe: 'src/components/component-compare/component-compare.a11y.test.tsx — axe reports zero violations for both columns, on every fixture except the 5,000-row one (see the runbook), plus the loading, error and restricted states',
  axeBrowser:
    'tests/browser/component-compare.test.ts — axe in Chromium with colour contrast on, both columns in both themes',
  screenshots:
    'tests/browser/component-compare.test.ts — one screenshot per column per theme (COMPONENT_COMPARE_SHOTS)',
})
