import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'

export const Route = createFileRoute('/component-compare')({
  beforeLoad: () => {
    if (import.meta.env.PROD) {
      throw redirect({ to: '/' })
    }
  },
  component: lazyRouteComponent(
    () => import('./-component-compare-page'),
    'ComponentCompareRoute',
  ),
})
