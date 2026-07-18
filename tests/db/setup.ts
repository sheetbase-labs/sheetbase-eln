import { config } from 'dotenv'

// Load local environment before any test module evaluates, so server env
// validation sees .env.local regardless of import order.
config({ path: ['.env.local', '.env'] })
