import { config } from 'dotenv'

// Load local environment before any test module evaluates, so server env
// validation (env.server.ts) sees .env.local regardless of import order —
// the SCI-003 file routes import env.server transitively.
config({ path: ['.env.local', '.env'] })
