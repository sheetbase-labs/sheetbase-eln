/**
 * Maps Better Auth / OAuth error parameters to recovery messages a person
 * can act on. Anything unrecognised stays generic — never echo raw provider
 * details into the page.
 */
export function describeSignInError(error: string | undefined): string | null {
  switch (error) {
    case undefined:
    case '':
      return null
    case 'access_denied':
      return 'GitHub sign-in was declined. Nothing was created — sign in again and accept the request to continue.'
    case 'github_email_not_found':
      return 'GitHub did not return an email address. Make a verified email visible on your GitHub account, then try again.'
    case 'state_mismatch':
    case 'invalid_state':
      return 'The sign-in attempt expired before it finished. Start again.'
    case 'INVALID_TOKEN':
    case 'EXPIRED_TOKEN':
    case 'ATTEMPTS_EXCEEDED':
      return 'That sign-in link has expired or was already used. Ask for a new one.'
    case 'oidc_not_configured':
      return 'Company sign-in is not configured for this environment yet.'
    case 'github_not_configured':
      return 'GitHub sign-in is not configured for this environment yet.'
    default:
      return 'Sign-in failed. Try again, and contact the workspace owner if it keeps failing.'
  }
}
