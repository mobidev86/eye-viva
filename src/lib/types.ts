export type Finding = {
  id: string
  eye: 'right' | 'left' | 'both' | null
  label: string
  value: string | number | null
  unit: string | null
  method: string | null
  available: boolean
  unavailable_reason?: string
}

export type CaseData = {
  case_id: string
  title: string
  opening_prompt: string
  patient: Record<string, unknown>
  findings: Finding[]
  examiner_notes: { diagnosis: string; key_points: string[]; follow_up_ideas: string[] }
}

/** What the client is allowed to see of a finding. */
export type RevealedFinding = {
  id: string
  eye: Finding['eye']
  label: string
  available: boolean
  /** Exact value + unit as shown on screen (null when unavailable). */
  display: string | null
  method: string | null
  reason: string | null
}

export type Turn = {
  role: 'trainee' | 'examiner'
  text: string
  at: number
  findingIds?: string[]
  /** 'answer' = diagnosis/management statement, 'reply' = reply to the follow-up. Only these feed the revision point. */
  tag?: 'answer' | 'reply'
  /** ms from end of trainee speech to first examiner audio (examiner turns only). */
  latencyMs?: number | null
}

export type Citation = { page: number; section: string; excerpt: string; chunkId: string }

export type Revision =
  | { supported: true; point: string; citation: Citation; retrievedPages: number[] }
  | { supported: false; message: string; retrievedPages: number[] }

export type Attempt = {
  uid: string
  caseId: string
  createdAt: number
  phase: 'examine' | 'followup' | 'done'
  revealedIds: string[]
  turns: Turn[]
  followUp: string | null
  revision: Revision | null
}
