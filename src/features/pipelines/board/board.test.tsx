import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  BoardBlock,
  BoardButton,
  BoardIo,
  BoardList,
  BoardRow,
  BoardScope,
  BoardSegmented,
  BoardStatus,
} from './board'

describe('board components', () => {
  it('draw the board markup: list, block, row, status and switch', () => {
    const html = renderToStaticMarkup(
      <BoardScope>
        <BoardList>
          <BoardBlock selected>
            <BoardRow
              icon="table"
              kind="Calculate"
              summary="Step yield per run"
              rows="96"
              status={<BoardStatus tone="ok">Passed</BoardStatus>}
            />
          </BoardBlock>
        </BoardList>
        <BoardSegmented
          label="Edit as"
          options={[
            { value: 'form', label: 'Form' },
            { value: 'sql', label: 'SQL' },
          ]}
          value="form"
          onChange={() => undefined}
        />
        <BoardButton variant="primary" size="sm">
          Go
        </BoardButton>
        <BoardIo rows={[{ label: 'Reads', value: 'previous', mine: true }]} />
      </BoardScope>,
    )

    expect(html).toContain('class="pb-blk pb-sel"')
    expect(html).toContain('class="pb-row"')
    expect(html).toContain('class="dot st-ok"')
    expect(html).toContain('class="seg"')
    expect(html).toContain('btn btn-p btn-s')
    expect(html).toContain('class="me"')
  })
})
