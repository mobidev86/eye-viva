import { createServerFn } from '@tanstack/react-start'
import caseJson from '../../data/case.json'
import noteJson from '../../data/note-chunks.json'
import type { CaseData } from '../lib/types'
import { examinerTurn } from '../lib/viva'
import { buildRevision, type NoteIndex } from '../lib/retrieval'

const c = caseJson as unknown as CaseData

/** Only what the trainee may see up front. Examiner notes never leave the server. */
export const getCase = createServerFn({ method: 'GET' }).handler(async () => ({
  caseId: c.case_id,
  title: c.title,
  openingPrompt: c.opening_prompt,
  disclaimer: (caseJson as any).disclaimer as string,
}))

export const takeTurn = createServerFn({ method: 'POST' })
  .validator((d: { utterance: string; forceAnswer?: boolean }) => ({
    utterance: String(d.utterance ?? '').slice(0, 2000),
    forceAnswer: !!d.forceAnswer,
  }))
  .handler(async ({ data }) => examinerTurn(c, data.utterance, data.forceAnswer))

export const makeRevision = createServerFn({ method: 'POST' })
  .validator((d: { answers: string[] }) => ({ answers: (Array.isArray(d.answers) ? d.answers : []).map((a) => String(a).slice(0, 2000)).slice(0, 20) }))
  .handler(async ({ data }) => buildRevision(noteJson as unknown as NoteIndex, data.answers.join(' . ')))
