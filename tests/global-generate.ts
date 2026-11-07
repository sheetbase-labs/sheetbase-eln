import { ensureGenerated } from '../scripts/ensure-generated.mjs'

/** Vitest global setup: generate the uncommitted derived files if missing. */
export default function setup() {
  ensureGenerated()
}
