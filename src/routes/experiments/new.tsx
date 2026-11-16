import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { PageHeader } from '#/components/ui/layout'
import { parseCreateContext } from '#/lib/create-context-search'
import type { CreateContextSearch } from '#/lib/create-context-search'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'
import { FORM_READ_TIMEOUT_MS } from './-new-experiment-sources'
import { useNewExperimentForm } from './-new-experiment-form-model'
import {
  DetailsFieldSection,
  FormActionsSection,
  ProjectFieldSection,
  TitleFieldSection,
  StartOptionsSection,
} from './-new-experiment-form-sections'
import { StartFromFields } from './-new-experiment-start-from'

export { FORM_READ_TIMEOUT_MS }

/**
 * UI port (roadmap-4/ui-app3): New experiment. app-3's form asks for a
 * reviewer, planned end and a protocol to follow; the ELN models an experiment
 * as a record with a project and a title, so only those are asked for and the
 * rest are stated as gaps. Creation uses the canonical
 * `create_record_with_blocks` RPC, so the new notebook opens on its own data.
 */
export const Route = createFileRoute('/experiments/new')({
  validateSearch: (
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack hands this hook the raw URL search object, which is unparsed by definition; `parseCreateContext` and the schemas below decode the keys this route owns.
    search: Record<string, unknown>,
  ): CreateContextSearch & {
    protocol?: string
    template?: string
    series?: string
  } => {
    const text = z.string().min(1).optional().catch(undefined)

    return {
      ...parseCreateContext(search),
      protocol: text.parse(search.protocol),
      template: text.parse(search.template),
      series: text.parse(search.series),
    }
  },
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: NewExperiment,
})

function NewExperiment() {
  const search = Route.useSearch()
  const form = useNewExperimentForm(search)

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    form.attemptCreate()
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        trail={form.trail}
        title={t('projects.newExperiment.title')}
      />
      <form
        className="flex w-full max-w-5xl flex-col gap-4 px-4 py-4 md:px-6"
        onSubmit={onSubmit}
      >
        <StartFromFields
          startFrom={form.startFrom}
          onChoose={form.chooseStart}
          effectiveProtocolVersionId={form.start.effectiveProtocolVersionId}
          protocolOptions={form.start.protocolOptions}
          templateError={form.start.templateError}
          templateId={form.templateId}
          templateOptions={form.start.templateOptions}
          templates={form.sources.templates.data ?? []}
          templatesLoading={form.sources.templates.isLoading}
          parameters={form.start.parameterRows}
          onParameter={form.setParameter}
        />
        <h2 className="text-base font-semibold text-fg">
          {t('projects.newExperiment.detailsTitle')}
        </h2>
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          <TitleFieldSection form={form} />
          <ProjectFieldSection form={form} />
          <DetailsFieldSection form={form} />
        </div>
        <StartOptionsSection form={form} />
        <FormActionsSection form={form} />
      </form>
    </div>
  )
}
