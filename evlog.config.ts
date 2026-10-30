import { defineEvlog } from 'evlog'

const level = process.env.LOG_LEVEL?.toLowerCase()
const minLevel = ['debug', 'info', 'warn', 'error'].includes(level ?? '')
  ? (level as 'debug' | 'info' | 'warn' | 'error')
  : 'info'

export default defineEvlog({
  service: 'sheetbase-eln',
  minLevel,
  pretty:
    process.env.LOG_FORMAT === 'pretty'
      ? true
      : process.env.LOG_FORMAT === 'json'
        ? false
        : undefined,
  // Page loads and static assets are noise; the API and sign-in are not.
  include: ['/api/**'],
  // In development keep only failures and slow requests, unless
  // LOG_LEVEL=debug asks for everything; hosted installs keep every event.
  ...(process.env.NODE_ENV !== 'development' || minLevel === 'debug'
    ? {}
    : {
        sampling: {
          rates: { info: 0 },
          keep: [{ status: 400 }, { duration: 1000 }],
        },
      }),
})
