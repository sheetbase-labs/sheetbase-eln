import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'
import { z } from 'zod'

import { parseCreateContext } from '#/lib/create-context-search'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** What the schedule page reads from the URL. */
interface ScheduleSearch {
  book?: string
  experiment?: string
  returnTo?: string
}

/** One named param: the URL carried a non-empty string. */
const namedParam = z.string().min(1)

export const Route = createFileRoute('/schedule')({
  // A deep link may ask to book one instrument (the registry inspector's Book
  // action): `?book=<instrumentId>` opens the dialog with it preselected.
  // `?experiment=` names the experiment the booking is for (it starts the
  // title) and `?returnTo=` is where to go once the person has booked or
  // dismissed the dialog.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack Router hands validateSearch the raw URL values as Record<string, unknown>; every value is decoded by namedParam or parseCreateContext before use.
  validateSearch: (search: Record<string, unknown>): ScheduleSearch => {
    const { experiment, returnTo } = parseCreateContext(search)
    const book = namedParam.safeParse(search.book)
    const decoded: ScheduleSearch = {}

    if (book.success) decoded.book = book.data

    if (experiment) decoded.experiment = experiment

    if (returnTo) decoded.returnTo = returnTo

    return decoded
  },
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: lazyRouteComponent(() => import('./-schedule-page'), 'Schedule'),
})
