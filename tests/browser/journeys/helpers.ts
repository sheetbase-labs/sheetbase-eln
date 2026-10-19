import { expect } from 'playwright/test'
import type { Page } from 'playwright/test'

import { signInAsDesignUser } from '../../visual/sign-in'

/** Gareth owns the seeded design workspace the journeys run against. */
export const DESIGN_USER = '00000000-0000-4000-8000-000000000310'

/** A name no seeded row uses, so a journey finds exactly what it created. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`
}

export async function signIn(page: Page): Promise<void> {
  await signInAsDesignUser(page, DESIGN_USER)
}

/** Create a project through the New project dialog and return its page URL. */
export async function createProject(
  page: Page,
  title: string,
): Promise<string> {
  await page.goto('/projects?new=true')
  await page
    .getByLabel(/^title|^name/i)
    .first()
    .fill(title)
  await page.getByRole('button', { name: /^create/i }).click()
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/)
  return new URL(page.url()).pathname
}

/** Create a blank draft experiment in a project and land on its page. */
export async function createExperiment(
  page: Page,
  projectPath: string,
  title: string,
): Promise<string> {
  const projectId = projectPath.split('/').pop() ?? ''
  await page.goto(`/experiments/new?project=${projectId}`)
  await page.getByLabel(/^title/i).fill(title)
  await page.getByRole('button', { name: /create draft/i }).click()
  await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}\/notebook/)
  return new URL(page.url()).pathname.split('/')[2] ?? ''
}
