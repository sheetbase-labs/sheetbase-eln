import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CreateProjectForm } from './projects'
import { ProjectList } from '#/components/projects/project-list'

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

    expect(
      screen.getByPlaceholderText('e.g. Lentivector stability study'),
    ).toBeTruthy()
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

    const input = screen.getByPlaceholderText(
      'e.g. Lentivector stability study',
    )
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(
      'project-title-hint project-title-error',
    )
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

describe('Project filtering', () => {
  it('recovers from an empty result without losing keyboard focus', () => {
    render(
      <ProjectList
        projects={[
          {
            id: 'p1',
            key: 'virus-stability',
            title: 'Virus Stability',
            status: 'active',
            createdAt: '2026-07-18T12:00:00Z',
          },
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )
    const input = screen.getByRole('searchbox', { name: 'Filter projects' })
    fireEvent.change(input, { target: { value: 'missing' } })
    expect(screen.getByText('No projects match “missing”.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Virus Stability/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(screen.getByRole('link', { name: /Virus Stability/ })).toBeTruthy()
    expect(document.activeElement).toBe(input)
    expect((input as HTMLInputElement).value).toBe('')
  })
})

describe('Project table controls', () => {
  const projects = Array.from({ length: 25 }, (_, i) => ({
    id: `p${i}`,
    key: `study-${i}`,
    title: `Study ${String(i).padStart(2, '0')}`,
    status: i === 24 ? 'archived' : 'active',
    createdAt: '2026-09-01T00:00:00Z',
  }))
  it('paginates and resets to the first page when the status changes', async () => {
    render(
      <ProjectList
        projects={projects}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )
    expect(screen.queryByText('Study 20')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Study 20')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Project status'), {
      target: { value: 'archived' },
    })
    expect(await screen.findByText('Study 24')).toBeTruthy()
    expect(screen.queryByText('Study 20')).toBeNull()
  })
  it('sorts across the full filtered list before pagination', () => {
    render(
      <ProjectList
        projects={projects}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Project' }))
    fireEvent.click(screen.getByRole('button', { name: 'Project' }))
    const links = screen.getAllByRole('link')
    expect(links[0].textContent).toContain('Study 23')
    expect(screen.queryByText('Study 00')).toBeNull()
    expect(
      screen
        .getByRole('columnheader', { name: 'Project' })
        .getAttribute('aria-sort'),
    ).toBe('descending')
  })
  it('does not label the project update timestamp as activity', () => {
    render(
      <ProjectList
        projects={[{ ...projects[0], updatedAt: '2026-09-07T12:00:00Z' }]}
        recordCounts={{ p0: 0 }}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByRole('columnheader', { name: 'Created' })).toBeNull()
  })
})
