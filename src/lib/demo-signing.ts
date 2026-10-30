import * as React from 'react'

/**
 * True in the sign-in-free demo, where there are no passwords: signing is
 * confirmed by typing your name and the signature is marked "Demo signature".
 * The root route sets it from `auth.authFree`; it is never true on a real
 * install, and the server refuses a demo signature there regardless.
 */
export const DemoSigningContext = React.createContext(false)

export function useDemoSigning(): boolean {
  return React.useContext(DemoSigningContext)
}

/** The method shown for a signature, in the words a scientist would use. */
export function signatureMethodLabel(
  method: string,
  labels: { demo: string; password: string; session: string },
): string {
  if (method === 'demo') return labels.demo
  if (method === 'password') return labels.password
  return labels.session
}
