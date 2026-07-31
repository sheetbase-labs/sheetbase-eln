// Compute a better-auth signed session cookie value for Playwright.
import { createHmac } from 'node:crypto'
const token = process.argv[2]
const secret = process.argv[3] || 'dev-only-insecure-auth-secret-replace-me-0123456789'
const sig = createHmac('sha256', secret).update(token).digest('base64')
process.stdout.write(`${token}.${sig}`)
