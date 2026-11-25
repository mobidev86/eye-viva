import type { CaseData, RevealedFinding } from './types'
import { classify, matchFindings, matchHistory, reveal, spokenFor } from './findings'
import { chooseFollowUp } from './followup'

export type TurnResult =
  | { kind: 'findings'; revealed: RevealedFinding[]; spoken: string }
  | { kind: 'followup'; question: string; spoken: string; reason: string }
  | { kind: 'unknown'; spoken: string }

/** Pure, testable core of one examiner turn during the examine phase. */
export function examinerTurn(c: CaseData, utterance: string, forceAnswer = false): TurnResult {
  const intent = forceAnswer ? 'answer' : classify(utterance, c)
  if (intent === 'answer') {
    const f = chooseFollowUp(utterance, c)
    return { kind: 'followup', question: f.question, spoken: f.question, reason: f.reason }
  }
  if (intent === 'findings') {
    const revealed = [...matchHistory(utterance, c), ...matchFindings(utterance, c).map(reveal)]
    return { kind: 'findings', revealed, spoken: revealed.map(spokenFor).join(' ') }
  }
  return {
    kind: 'unknown',
    spoken:
      'I do not have that in this case. Ask for a history point such as allergies or medications, or a finding such as acuity, pressure, cornea, pupil or gonioscopy, or give me your diagnosis and management.',
  }
}
