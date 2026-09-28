import { Client } from 'pg'
import { config } from 'dotenv'
config({ path: ['.env.local', '.env'] })
const c = new Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const rows = await c.query(`select pid, datname, state, wait_event_type, wait_event, left(query,60) q from pg_stat_activity where datname like 'sheetbase_test%' and pid <> pg_backend_pid()`)
console.log(rows.rows)
for (const r of rows.rows) { await c.query('select pg_terminate_backend($1)', [r.pid]) }
console.log('terminated', rows.rowCount)
await c.end()
