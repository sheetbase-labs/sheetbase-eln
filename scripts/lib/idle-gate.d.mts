export interface IdleGate {
  touch: () => void
  hold: () => () => void
  isIdle: () => boolean
}

export interface IntervalTarget {
  setInterval: (callback: () => void, delay?: number) => unknown
}

export function createIdleGate(options: {
  idleAfterMs: number
  now?: () => number
}): IdleGate

export function idleAfterMsFromEnv(
  env?: Record<string, string | undefined>,
): number | null

export function gateIntervals(
  gate: IdleGate,
  target?: IntervalTarget,
): () => void
