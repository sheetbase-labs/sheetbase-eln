import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** DSET-05 / R5-SURF-04 — the import wizard. Step 1 chooses the target and
 * stores the file; the stored file's own route carries the mapping and check
 * steps. Both are children of this route, so it renders the outlet and nothing
 * else — the child route could never appear while this route rendered the
 * upload form itself. */
export const Route = createFileRoute('/import')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: () => <Outlet />,
})
