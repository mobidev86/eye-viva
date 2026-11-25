import type { CaseData } from './types'
import { normalise } from './findings'

const has = (u: string, re: RegExp) => re.test(u)

/**
 * Pick ONE follow-up that responds to what the trainee actually said.
 * Questions come from the examiner's follow_up_ideas plus two gap-probes.
 */
export function chooseFollowUp(answer: string, c: CaseData): { question: string; reason: string } {
  const u = normalise(answer)
  const ideas = c.examiner_notes.follow_up_ideas
  const pick = (re: RegExp) => ideas.find((i) => re.test(i)) ?? ideas[0]

  if (!has(u, /\b(angle closure|closed angle|acute glaucoma|pac|apac)\b/))
    return {
      question:
        'You have not named a diagnosis yet. What is the single most likely diagnosis, and which findings so far support it?',
      reason: 'no diagnosis named',
    }
  if (has(u, /\b(acetazolamide|diamox)\b/) && !has(u, /\b(sulfa|sulpha|sulfonamide|allerg\w*)\b/))
    return {
      question:
        'You mentioned acetazolamide. Before you prescribe it, what in this patient’s history would you want to check?',
      reason: 'acetazolamide without allergy check',
    }
  if (has(u, /\bpilocarpine\b/))
    return {
      question: `You mentioned pilocarpine. ${pick(/pilocarpine/)}`,
      reason: 'pilocarpine mentioned',
    }
  if (!has(u, /\b(left|fellow|other eye|both eyes|prophyla\w*|bilateral)\b/))
    return { question: pick(/left eye/), reason: 'fellow eye not mentioned' }
  return { question: pick(/doesn't come down|does not come down/), reason: 'default escalation question' }
}
