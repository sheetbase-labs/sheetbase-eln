import { config } from 'dotenv'
import { startApiTestStack } from './isolated-stack'
import { afterAll } from 'vitest'

// Load local environment before any test module evaluates, so server env
// validation (env.server.ts) sees .env.local regardless of import order —
// the SCI-003 file routes import env.server transitively.
config({ path: ['.env.local', '.env'] })

// Setup files evaluate before application imports capture their connections.
// Each file owns its database and PostgREST; no fixture DELETE can undo
// retained evidence, and no running development stack receives test writes.
const stop = await startApiTestStack()
afterAll(stop)
