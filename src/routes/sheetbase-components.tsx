import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'

export const Route = createFileRoute('/sheetbase-components')({
  beforeLoad: () => {
    if (import.meta.env.PROD) {
      throw redirect({ to: '/' })
    }
  },
  component: lazyRouteComponent(
    () => import('./-sheetbase-components-page'),
    'SheetbaseComponentsDemo',
  ),
})
