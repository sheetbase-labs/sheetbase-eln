/**
 * PLAT-05 — load local env vars as a module side effect.
 *
 * ESM imports evaluate before the importing module's body, so scripts that
 * import server modules (which validate `process.env` at import time via
 * `#/env.server`) must load `.env.local` from a module evaluated FIRST.
 * Import this before any `#/lib/*` server import.
 */
import { config } from 'dotenv'

config({ path: ['.env.local', '.env'] })
