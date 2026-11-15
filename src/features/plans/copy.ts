/** Plans copy, read as `t('features.plans.…')`. */
export const copy = {
  cards: {
    runPlan: {
      apply: 'Approve plan',
      applying: 'Running…',
      applied: 'Plan done',
    },
  },
  plan: {
    label: 'Plan',
    steps: {
      one: '{count} step, in order',
      other: '{count} steps, in order',
    },
    runAll: 'Run all',
    runAllHint:
      'Runs every step now, including the ones that would wait for your OK.',
    approveStep: 'Approve this step',
    stop: 'Stop here',
    waiting: 'Waiting',
    running: 'Running',
    done: 'Done',
    paused: 'Needs your OK',
    failed: 'Failed',
    skipped: 'Not run',
    stopped: 'Stopped. The steps above stay done.',
    failedStop: 'Stopped at step {number}. The steps before it are done.',
    failedFirst: 'Stopped at step 1. Nothing was changed.',
    pausedAt: 'Paused at step {number}: it removes or ends something.',
    needsSignature:
      'This step waits for a signature, so the plan stops here. Finish it on the Agents page.',
    open: 'Open',
    allDone: 'All steps done',
  },
} as const
