export interface IdleGate {
  touch(): void
  hold(): () => void
  isIdle(): boolean
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
  target?: { setInterval: typeof setInterval },
): () => void
