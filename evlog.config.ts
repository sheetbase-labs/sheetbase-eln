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
  // The card and bank number patterns match the digit groups inside ids (a
  // user id came out as ****4000-****0001), which makes events impossible to
  // correlate, and a lab ELN holds no card data. Emails, JWTs, bearer headers
  // and any key ending in password, secret or token are still masked.
  redact: {
    builtins: ['email', 'jwt', 'bearer', 'secrets'],
  },
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
