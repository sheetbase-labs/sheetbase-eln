import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CreateProjectForm, ProjectList } from './projects'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ useRouteContext: () => ({}) }),
  redirect: (options: unknown) => options,
  Outlet: () => null,
  useRouterState: () => '/projects',
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
  } & Record<string, unknown>) => {
    let href = to
    for (const [key, value] of Object.entries(params ?? {}))
      href = href.replace(`$${key}`, encodeURIComponent(value))
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

afterEach(() => {
  cleanup()
})

describe('CreateProjectForm', () => {
  it('renders the title input and submit button', () => {
    render(
      <CreateProjectForm
        title=""
        onTitleChange={() => {}}
        onSubmit={() => {}}
        isPending={false}
        validationError={null}
      />,
    )

    expect(screen.getByPlaceholderText('New project title')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create project' })).toBeTruthy()
  })

  it('disables the button when the title is empty', () => {
    render(
      <CreateProjectForm
        title=""
        onTitleChange={() => {}}
        onSubmit={() => {}}
        isPending={false}
        validationError={null}
      />,
    )

    const button = screen.getByRole('button', { name: 'Create project' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('enables the button when the title has text', () => {
    render(
      <CreateProjectForm
        title="Virus Stability"
        onTitleChange={() => {}}
        onSubmit={() => {}}
        isPending={false}
        validationError={null}
      />,
    )

    const button = screen.getByRole('button', { name: 'Create project' })
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('shows the validation error and links it to the input', () => {
    render(
      <CreateProjectForm
        title=""
        onTitleChange={() => {}}
        onSubmit={() => {}}
        isPending={false}
        validationError="Give the project a title first."
      />,
    )

    const input = screen.getByPlaceholderText('New project title')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe('project-title-error')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Give the project a title first.')
  })

  it('shows a pending label and disables the button while creating', () => {
    render(
      <CreateProjectForm
        title="Virus"
        onTitleChange={() => {}}
        onSubmit={() => {}}
        isPending={true}
        validationError={null}
      />,
    )

    const button = screen.getByRole('button', { name: 'Creating…' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('calls onSubmit when the form is submitted', () => {
    const onSubmit = vi.fn((event) => event.preventDefault())
    render(
      <CreateProjectForm
        title="Virus"
        onTitleChange={() => {}}
        onSubmit={onSubmit}
        isPending={false}
        validationError={null}
      />,
    )

    screen.getByRole('button', { name: 'Create project' }).click()
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})

describe('ProjectList', () => {
  it('shows a loading state', () => {
    render(
      <ProjectList
        projects={[]}
        isLoading={true}
        error={null}
        onRetry={() => {}}
      />,
    )

    const loading = screen.getByText('Loading projects…')
    expect(loading).toBeTruthy()
    expect(loading.getAttribute('aria-busy')).toBe('true')
  })

  it('shows an error state with a retry control', () => {
    render(
      <ProjectList
        projects={[]}
        isLoading={false}
        error={new Error('down')}
        onRetry={() => {}}
      />,
    )

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Could not load projects.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('shows an empty state when there are no projects', () => {
    render(
      <ProjectList
        projects={[]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )

    expect(
      screen.getByText('No projects yet. Create your first one above.'),
    ).toBeTruthy()
  })

  it('renders the title, key and date for each project', () => {
    render(
      <ProjectList
        projects={[
          {
            id: 'p1',
            key: 'virus-stability',
            title: 'Virus Stability',
            status: 'active',
            createdAt: '2026-07-18T12:00:00.000Z',
          },
          {
            id: 'p2',
            key: 'titration-assay',
            title: 'Titration Assay',
            status: 'active',
            createdAt: '2026-07-17T12:00:00.000Z',
          },
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )

    expect(screen.getByText('Virus Stability')).toBeTruthy()
    expect(screen.getByText('virus-stability')).toBeTruthy()
    expect(screen.getByText('Titration Assay')).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: /Virus Stability/ })
        .getAttribute('href'),
    ).toBe('/projects/p1')
  })
})
