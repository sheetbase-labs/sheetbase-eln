/**
 * The one thing these tests stand in for is the sign-in cookie. Better Auth
 * turns a cookie into a session; here the session is simply "this person".
 * Everything after that (workspace lookup, the token for PostgREST, row-level
 * security) is the real code.
 */
export const signedIn: { userId: string | null } = { userId: null }

export function authMock<T extends object>(original: T): T {
  return {
    ...original,
    getAppSession: async () =>
      signedIn.userId
        ? {
            user: {
              id: signedIn.userId,
              name: 'Test Scientist',
              email: 'scientist@assistant-e2e.test',
            },
            session: { id: 'assistant-e2e-session' },
          }
        : null,
  }
}
