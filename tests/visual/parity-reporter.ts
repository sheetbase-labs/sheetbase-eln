import { mkdirSync, writeFileSync } from 'node:fs'
import type {
  Reporter,
  TestCase,
  TestResult,
} from 'playwright/types/testReporter'

import {
  DESIGN_PENDING,
  DESIGN_SCREEN_SIZES,
  DESIGN_STATES,
} from './design-states'

/** Count only executed, successful full-screen comparisons as parity. */
export default class ParityReporter implements Reporter {
  private results = new Map<string, TestResult['status']>()

  onTestEnd(test: TestCase, result: TestResult) {
    if (test.location.file.endsWith('/parity.spec.ts')) {
      this.results.set(
        test.title,
        test.expectedStatus === 'passed' ? result.status : 'failed',
      )
    }
  }

  onEnd() {
    const mapped = new Set(
      DESIGN_STATES.map(({ screen, theme }) => `${screen} — ${theme}`),
    )
    const screens = Object.keys(DESIGN_SCREEN_SIZES).map((screen) => {
      const reason = DESIGN_PENDING.find((group) =>
        group.screens.includes(screen),
      )?.reason
      const themes = Object.fromEntries(
        ['light', 'dark'].map((theme) => {
          const title = `${screen} — ${theme}`
          return [
            theme,
            mapped.has(title)
              ? (this.results.get(title) ?? 'not-run')
              : 'pending',
          ]
        }),
      )
      return { screen, themes, reason }
    })
    const passed = screens.filter(
      ({ themes }) => themes.light === 'passed' && themes.dark === 'passed',
    ).length
    mkdirSync('test-results', { recursive: true })
    writeFileSync(
      'test-results/parity-coverage.json',
      JSON.stringify({ passed, total: screens.length, screens }, null, 2) +
        '\n',
    )
    process.stdout.write(
      `\nParity: ${passed}/${screens.length} screens passed in both themes\n` +
        screens
          .map(
            ({ screen, themes, reason }) =>
              `  ${screen}: light=${themes.light}, dark=${themes.dark}${reason ? ` (${reason})` : ''}`,
          )
          .join('\n') +
        '\n',
    )
  }
}
