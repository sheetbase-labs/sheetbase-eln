/**
 * Whether this server can send email at all. Email is set up in the server's
 * environment, not in a setting, so the notification choices need to say when
 * nothing will leave the building.
 */
import { createServerFn } from '@tanstack/react-start'

export interface EmailStatus {
  configured: boolean
}

export const emailStatusQueryKeys = {
  status: () => ['email-status'] as const,
}

export const fetchEmailStatusFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<EmailStatus> => {
    // `*.server.*` modules cannot be imported statically into the client bundle.
    const { readSmtpConfig } = await import('./email-delivery.server')
    return { configured: readSmtpConfig() !== null }
  },
)
