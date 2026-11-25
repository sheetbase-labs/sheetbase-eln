import {
  createIdleGate,
  gateIntervals,
  idleAfterMsFromEnv,
} from './idle-gate.mjs'

/**
 * Turns the idle gate on when `SHEETBASE_IDLE_AFTER_MS` is set, before the app
 * module starts its sweeps. Returns the gate, or undefined when it is off.
 */
export function gateStartedIntervals(env = process.env, onChange) {
  const idleAfterMs = idleAfterMsFromEnv(env)

  if (!idleAfterMs) return undefined

  const gate = createIdleGate({ idleAfterMs })
  gateIntervals(gate, globalThis, onChange)

  return gate
}
