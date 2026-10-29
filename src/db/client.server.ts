import { drizzle } from 'drizzle-orm/node-postgres'

import { env } from '#/env.server'

import { getPool } from './pool.server'
import * as schema from './schema'

// Drizzle runs on the shared pool, so `db.$client` is the one pool every
// server path borrows from.
export const db = drizzle({ client: getPool(env.DATABASE_URL), schema })
