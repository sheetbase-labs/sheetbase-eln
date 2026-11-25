/**
 * Lets a hosted copy go quiet when nobody is using it, so a platform that
 * sleeps idle services (Railway "App Sleeping") can actually sleep it and its
 * database. Every background sweep is a `setInterval` that reads the database;
 * while the gate is idle their ticks are skipped, so the process sends no
 * traffic. The next request ends the idle state and the sweeps carry on at
 * their next tick (they are all repeatable catch-up sweeps).
 *
 * Off unless `SHEETBASE_IDLE_AFTER_MS` is a positive number.
 */

export function createIdleGate({ idleAfterMs, now = Date.now }) {
  let lastActivity = now()
  let open = 0

  return {
    /** A request arrived (or a page asked for something). */
    touch() {
      lastActivity = now()
    },
    /** A long-lived connection (event stream, live editing) opened. */
    hold() {
      open += 1
      lastActivity = now()
      let released = false

      return () => {
        if (released) return
        released = true
        open -= 1
        lastActivity = now()
      }
    },
    isIdle() {
      return open === 0 && now() - lastActivity >= idleAfterMs
    },
  }
}

/** Reads the idle window from the environment; null means the gate is off. */
export function idleAfterMsFromEnv(env = process.env) {
  const value = Number(env.SHEETBASE_IDLE_AFTER_MS)

  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Wraps `setInterval` on `target` so a tick is skipped while the gate is
 * idle. Returns a function that puts the original back.
 */
export function gateIntervals(gate, target = globalThis) {
  const original = target.setInterval

  target.setInterval = function gatedSetInterval(callback, delay, ...args) {
    if (typeof callback !== 'function')
      return original.call(target, callback, delay, ...args)

    return original.call(
      target,
      (...tickArgs) => {
        if (gate.isIdle()) return

        return callback(...tickArgs)
      },
      delay,
      ...args,
    )
  }

  return () => {
    target.setInterval = original
  }
}
