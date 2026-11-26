/**
 * Sheets and sheet layouts from the assistant: make a sheet, fill its columns
 * and rows, add a calculation or a comment, put it in a notebook, and keep a
 * sheet layout (what the database calls a sheet definition). The calls
 * themselves are declared with the schema and notebook features; this folder
 * holds the cards.
 */
import { defineFeature } from '../define'
import { SHEET_CARDS } from './cards'

export const feature = defineFeature({
  name: 'sheet-cards',
  assistantProposeTools: SHEET_CARDS.map((card) => card.tool),
  assistantCardActions: Object.fromEntries(
    SHEET_CARDS.map((card) => [card.tool, card.does]),
  ),
  assistantCovers: Object.fromEntries(
    SHEET_CARDS.flatMap((card) => card.covers.map((rpc) => [rpc, card.tool])),
  ),
})
