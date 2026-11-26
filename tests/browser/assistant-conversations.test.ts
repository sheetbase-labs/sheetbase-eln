/**
 * The assistant, as a person uses it: ask on the Agent page, read the answer,
 * press Apply on its cards one after another, and open what it made.
 *
 * The model is scripted (a real server speaking the provider protocol on a
 * fixed port the app server is told about, see playwright.config.ts); the app,
 * the database and every card's change are real. Each test asserts what the
 * person sees and what the database holds afterwards.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import { startMockModel, BROWSER_MODEL_PORT } from '../api/assistant/mock-model'
import type { MockModel } from '../api/assistant/mock-model'
import { signInAsDesignUser } from '../visual/sign-in'
import { waitForHydration } from './journeys/helpers'

config({ path: ['.env.local', '.env'] })

test.setTimeout(120_000)

const USER_ID = '00000000-0000-4000-8000-000000000310'
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000300'

let admin: Client
let model: MockModel
let original: Record<string, unknown> | undefined

test.beforeAll(async () => {
  model = await startMockModel(BROWSER_MODEL_PORT)
  admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL })
  await admin.connect()
  original = (
    await admin.query(
      `select ai_enabled, ai_provider_profile, ai_cloud_egress_enabled, ai_model,
              ai_max_tokens_per_call, ai_max_cost_microusd_per_call
         from api.workspace_settings where workspace_id = $1`,
      [WORKSPACE_ID],
    )
  ).rows[0]
  await admin.query(
    `update api.workspace_settings
        set ai_enabled = true, ai_provider_profile = 'scripted',
            ai_model = 'sheetbase-assist-1',
            ai_max_tokens_per_call = 200000,
            ai_max_cost_microusd_per_call = 5000000
      where workspace_id = $1`,
    [WORKSPACE_ID],
  )
})

test.afterAll(async () => {
  if (original) {
    await admin.query(
      `update api.workspace_settings
          set ai_enabled = $2, ai_provider_profile = $3,
              ai_cloud_egress_enabled = $4, ai_model = $5,
              ai_max_tokens_per_call = $6, ai_max_cost_microusd_per_call = $7
        where workspace_id = $1`,
      [
        WORKSPACE_ID,
        original.ai_enabled,
        original.ai_provider_profile,
        original.ai_cloud_egress_enabled,
        original.ai_model,
        original.ai_max_tokens_per_call,
        original.ai_max_cost_microusd_per_call,
      ],
    )
  }

  await admin.end()
  await model.stop()
})

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, USER_ID)
})

async function openAgent(page: Page) {
  await page.goto('/agent')
  await waitForHydration(page)
  await expect(page.getByTestId('assistant-question')).toBeVisible()
}

async function ask(page: Page, question: string) {
  // Enter sends; the dev tools button floats over the Ask button.
  const box = page.getByTestId('assistant-question')
  await box.fill(question)
  await box.press('Enter')
}

test('a record in an answer opens in the app, not as an external link', async ({
  page,
}) => {
  const experiment = (
    await admin.query<{ id: string; identifier: string; title: string }>(
      `select id, identifier, title from api.records
        where workspace_id = $1 and kind = 'experiment' and deleted_at is null
        order by identifier limit 1`,
      [WORKSPACE_ID],
    )
  ).rows[0]

  model.use(() => ({
    text: `Have a look at [${experiment.identifier}](/experiments/${experiment.id}) and at https://example.org/protocol for the outside view.`,
  }))

  await openAgent(page)
  await ask(page, 'Which experiment should I look at?')

  const answer = page.getByTestId('assistant-answer').last()
  await expect(answer).toContainText('Have a look at')

  const link = answer.getByRole('link', { name: experiment.identifier })
  await expect(link).toBeVisible()
  await link.click()

  // It opened the record (in a pane), and no "Open external link?" check came up.
  await expect(page.getByText('Open external link?')).toHaveCount(0)
  await expect(page.getByText(experiment.title).first()).toBeVisible()
})

/** An experiment with an empty notebook, in a project of its own. */
async function makeExperiment(name: string) {
  const project = (
    await admin.query<{ id: string }>(
      `insert into api.projects(workspace_id, key, title, lead_user_id)
       values ($1, $2, $3, $4) returning id`,
      [
        WORKSPACE_ID,
        `e2e-${name}`.toLowerCase().replaceAll(' ', '-'),
        name,
        USER_ID,
      ],
    )
  ).rows[0]

  const experiment = (
    await admin
      .query<{ id: string; identifier: string }>(
        `select id, identifier from api.create_record($1, 'experiment', $2)`,
        [project.id, `${name} experiment`],
      )
      .catch(async () => ({
        rows: (
          await admin.query<{ id: string; identifier: string }>(
            `insert into api.records(workspace_id, project_id, kind, identifier, title, status, created_by_user_id)
           values ($1, $2, 'experiment', 'EXP-' || (9000 + floor(random() * 999))::int, $3, 'draft', $4)
           returning id, identifier`,
            [WORKSPACE_ID, project.id, `${name} experiment`, USER_ID],
          )
        ).rows,
      }))
  ).rows[0]

  return { project, experiment }
}

test('three notebook text cards apply one after another and the notebook shows them', async ({
  page,
}) => {
  const { experiment } = await makeExperiment('Cards in a row')

  const texts = [
    'Milestone 1: prepare and filter the buffers.',
    'Milestone 2: load the samples onto the plate.',
    'Milestone 3: read the plate and export the data.',
  ]

  model.use((request) =>
    request.step === 0
      ? {
          calls: texts.map((text, index) => ({
            name: 'sheetbase.notebook_block.insert',
            arguments: {
              title: `Text for milestone ${index + 1}`,
              summary: 'Write what the milestone involves',
              recordId: experiment.id,
              text,
            },
          })),
        }
      : { text: 'Here is the text for each milestone.' },
  )

  await openAgent(page)
  await ask(page, 'Write the text for each milestone')

  const cards = page.getByTestId('assistant-proposal')
  await expect(cards).toHaveCount(3, { timeout: 30_000 })

  for (let index = 0; index < 3; index += 1) {
    await cards
      .nth(index)
      .getByRole('button', { name: 'Apply', exact: true })
      .click()
    await expect(cards.nth(index)).toHaveAttribute('data-state', 'applied', {
      timeout: 30_000,
    })
  }

  await expect
    .poll(async () =>
      (
        await admin.query<{ payload: unknown }>(
          `select payload from api.blocks where record_id = $1`,
          [experiment.id],
        )
      ).rows
        .map((row) => JSON.stringify(row.payload))
        .join(' '),
    )
    .toContain(texts[2])

  await page.goto(`/experiments/${experiment.id}/notebook`)
  await waitForHydration(page)

  for (const text of texts)
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 30_000 })
})

test('a plan creates a project and a reagent in it, and the project opens from the card', async ({
  page,
}) => {
  model.use((request) =>
    request.step === 0
      ? {
          calls: [
            {
              name: 'sheetbase.plan.propose',
              arguments: {
                title: 'Project and reagent',
                summary: 'Create Browser Plan Project and add a reagent to it',
                steps: [
                  {
                    title: 'Create the project',
                    tool: 'sheetbase.project.create',
                    arguments: {
                      title: 'Create the project',
                      summary: 'A new project',
                      projectName: 'Browser plan project',
                    },
                  },
                  {
                    title: 'Add the reagent',
                    tool: 'sheetbase.record.create',
                    arguments: {
                      title: 'Add the reagent',
                      summary: 'A new reagent',
                      kind: 'material',
                      name: 'Browser plan reagent',
                      project: 'Browser plan project',
                    },
                  },
                ],
              },
            },
          ],
        }
      : { text: 'I have prepared a plan.' },
  )

  await openAgent(page)
  await ask(
    page,
    'Create a project called Browser plan project and add a reagent to it',
  )

  const plan = page.getByTestId('assistant-plan')
  await expect(plan).toBeVisible({ timeout: 30_000 })
  await plan.getByRole('button', { name: 'Approve plan' }).click()
  await expect(plan).toHaveAttribute('data-state', 'done', { timeout: 60_000 })

  const rows = (
    await admin.query<{ project: string }>(
      `select p.title as project from api.records r
         join api.projects p on p.id = r.project_id
        where r.workspace_id = $1 and r.title = 'Browser plan reagent'`,
      [WORKSPACE_ID],
    )
  ).rows

  expect(rows).toEqual([{ project: 'Browser plan project' }])
})
