import { describe, expect, it } from 'vitest'
import { addAnalysisToNotebook, notebookBlockHref } from './analysis-notebook'

interface Answer {
  block: { id: string }
  already_there: boolean
}

interface RpcParams {
  p_record_id?: string
  p_definition_id?: string
  p_title?: string | null
}

function client(answer: Partial<Answer>) {
  const calls: Array<{ name: string; params: RpcParams | undefined }> = []

  return {
    calls,
    rpc: async <T>(name: string, params?: RpcParams): Promise<T> => {
      calls.push({ name, params })

      // SAFETY: the fixture answers with the shape add_analysis_to_notebook returns.
      return answer as T
    },
  }
}

describe('addAnalysisToNotebook', () => {
  it('calls the database function with the experiment, the analysis and a trimmed title', async () => {
    const fake = client({ block: { id: 'b1' }, already_there: false })

    const added = await addAnalysisToNotebook(fake, {
      recordId: 'r1',
      definitionId: 'd1',
      title: '  Standard curve  ',
    })

    expect(fake.calls).toEqual([
      {
        name: 'add_analysis_to_notebook',
        params: {
          p_record_id: 'r1',
          p_definition_id: 'd1',
          p_title: 'Standard curve',
        },
      },
    ])
    expect(added).toEqual({ blockId: 'b1', alreadyThere: false })
  })

  it('leaves the title out so the analysis’s name is used, and reports a block that was already there', async () => {
    const fake = client({ block: { id: 'b9' }, already_there: true })

    const added = await addAnalysisToNotebook(fake, {
      recordId: 'r1',
      definitionId: 'd1',
      title: '   ',
    })

    expect(fake.calls[0]?.params).toMatchObject({ p_title: null })
    expect(added).toEqual({ blockId: 'b9', alreadyThere: true })
  })

  it('refuses an answer that is not a block', async () => {
    await expect(
      addAnalysisToNotebook(client({}), { recordId: 'r', definitionId: 'd' }),
    ).rejects.toThrow()
  })

  it('addresses a block by its notebook anchor', () => {
    expect(notebookBlockHref('r1', 'b1')).toBe(
      '/experiments/r1/notebook#block-b1',
    )
  })
})
