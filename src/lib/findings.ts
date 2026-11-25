import type { CaseData, Finding, RevealedFinding } from './types'

type Topic = { key: string; test: RegExp; ids: string[] }

// Topics map a spoken request to finding-id prefixes. Order matters only for readability.
const TOPICS: Topic[] = [
  { key: 'va', test: /\b(visual acuity|acuity|acuities|vision|snellen|va)\b/, ids: ['va'] },
  { key: 'iop', test: /\b(iop|pressures?|tonometry|applanation|intraocular)\b/, ids: ['iop'] },
  { key: 'conj', test: /\b(conjunctiva|conjunctival|redness|injection|ciliary flush)\b/, ids: ['conj'] },
  { key: 'cornea', test: /\b(cornea|corneal|epithelium)\b/, ids: ['cornea'] },
  { key: 'ac', test: /\b(anterior chamber|chamber depth|van herick|chamber)\b/, ids: ['ac'] },
  { key: 'rapd', test: /\b(rapd|relative afferent|afferent pupil\w*|swinging light)\b/, ids: ['rapd'] },
  { key: 'pupil', test: /\bpupils?\b/, ids: ['pupil'] },
  { key: 'lens', test: /\b(lens|cataract|nuclear sclerosis)\b/, ids: ['lens'] },
  { key: 'gonio', test: /\b(gonioscopy|gonio|drainage angle|angle)\b/, ids: ['gonio'] },
  { key: 'fundus', test: /\b(fundus|fundi|optic disc|disc|optic nerve|cup|macula|retina)\b/, ids: ['fundus'] },
  { key: 'refraction', test: /\b(refraction|refractive|glasses|spectacles|prescription|focimetry)\b/, ids: ['refraction'] },
  { key: 'axial', test: /\b(axial length|biometry|a scan)\b/, ids: ['axial_length'] },
  { key: 'oct', test: /\b(oct|optical coherence)\b/, ids: ['oct'] },
  { key: 'bp', test: /\b(blood pressure|bp)\b/, ids: ['bp'] },
  { key: 'ue', test: /\b(u and es?|u&es?|ues|urea|electrolytes?|bloods?|renal function)\b/, ids: ['u_and_e'] },
]

/** Rewrite phrases whose words would otherwise trigger a different topic ("blood pressure" is not IOP; "afferent pupil defect" is not the pupil exam). */
function clean(utterance: string): string {
  return normalise(utterance)
    .replace(/\bblood pressure\b/g, 'bp')
    .replace(/\b(relative )?afferent pupil\w*( defect)?\b/g, 'rapd')
}

export function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9&/\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function detectEyes(u: string): Array<'right' | 'left'> {
  const right = /\b(right|r eye|od|rt)\b/.test(u)
  const left = /\b(left|l eye|os|lt)\b/.test(u)
  if (/\b(both|each|either|bilateral|fellow)\b/.test(u) && !right && !left) return ['right', 'left']
  return [right && 'right', left && 'left'].filter(Boolean) as Array<'right' | 'left'>
}

/** Findings the trainee asked for, in the order they appear in the case file. */
export function matchFindings(utterance: string, c: CaseData): Finding[] {
  const u = clean(utterance)
  const topics = TOPICS.filter((t) => t.test.test(u))
  if (!topics.length) return []
  const eyes = detectEyes(u)
  const out: Finding[] = []
  for (const f of c.findings) {
    const base = f.id.replace(/_(right|left)$/, '')
    if (!topics.some((t) => t.ids.includes(base))) continue
    // Per-eye findings: honour the eye the trainee named; if none named, give both eyes.
    if ((f.eye === 'right' || f.eye === 'left') && eyes.length && !eyes.includes(f.eye)) continue
    out.push(f)
  }
  return out
}

const HISTORY: { id: string; key: string; label: string; test: RegExp }[] = [
  { id: 'hx_complaint', key: 'presenting_complaint', label: 'Presenting complaint', test: /\b(presenting complaint|symptoms?|onset|what happened)\b/ },
  { id: 'hx_ocular', key: 'past_ocular_history', label: 'Past ocular history', test: /\b(past ocular|ocular history|previous eye|eye surgery|eye history)\b/ },
  { id: 'hx_medical', key: 'past_medical_history', label: 'Past medical history', test: /\b(past medical|medical history|comorbidit\w*|pmh)\b/ },
  { id: 'hx_meds', key: 'medications', label: 'Medications', test: /\b(medications?|meds|medicines|drugs?|tablets|taking)\b/ },
  { id: 'hx_allergies', key: 'allergies', label: 'Allergies', test: /\b(allerg\w*)\b/ },
  { id: 'hx_family', key: 'family_history', label: 'Family history', test: /\b(family history|family|mother|relatives?)\b/ },
]

/** Patient history the trainee can ask for. "history" on its own returns all of it. */
export function matchHistory(utterance: string, c: CaseData): RevealedFinding[] {
  const u = clean(utterance)
  let hits = HISTORY.filter((h) => h.test.test(u))
  if (!hits.length && /\bhistory\b/.test(u)) hits = HISTORY
  return hits.flatMap((h) => {
    const raw = c.patient[h.key]
    if (raw == null) return []
    const display = Array.isArray(raw) ? raw.join('; ') : String(raw)
    return [{ id: h.id, eye: null, label: h.label, available: true, display, method: 'History', reason: null }]
  })
}

export function displayValue(f: Finding): string | null {
  if (!f.available || f.value === null) return null
  return f.unit && !String(f.value).includes(f.unit) ? `${f.value} ${f.unit}` : String(f.value)
}

export function reveal(f: Finding): RevealedFinding {
  return {
    id: f.id,
    eye: f.eye,
    label: f.label,
    available: f.available,
    display: displayValue(f),
    method: f.method,
    reason: f.available ? null : (f.unavailable_reason ?? 'Not available'),
  }
}

/** Make a value TTS-safe without changing any digit: "6/36" would be read as a date otherwise. */
export function speechify(text: string): string {
  return text
    .replace(/(\d+)\s*\/\s*(\d+)/g, '$1 over $2')
    .replace(/\bmmHg\b/g, 'millimetres of mercury')
    .replace(/\+(\d)/g, 'plus $1')
    .replace(/\bDS\b/g, 'dioptre sphere')
    .replace(/\bIOP\b/g, 'I O P')
}

export function eyeWords(eye: Finding['eye']): string {
  return eye === 'right' ? 'Right eye' : eye === 'left' ? 'Left eye' : eye === 'both' ? 'Both eyes' : 'General'
}

export function spokenFor(r: RevealedFinding): string {
  const who = r.eye === null ? '' : `${eyeWords(r.eye)}. `
  if (!r.available) return `${who}${r.label}: not available. ${r.reason}.`
  const method = r.method ? ` ${r.method}.` : ''
  return speechify(`${who}${r.label}: ${r.display}.${method}`)
}

export type Intent = 'findings' | 'answer' | 'unknown'

const ANSWER_CUES =
  /\b(diagnos\w*|my impression|i think|i believe|this is|this looks like|management|i would (start|give|treat|put|lie|stop|do)|i d (start|give|treat|put|lie|stop|do)|i ll (start|give|treat|put)|acute (primary )?angle closure|angle closure)\b/
// A request starts like a question or an ask; an answer starts like a statement ("I would give...", "This is...").
const REQUEST_START = /^(can|could|may|what|whats|show|tell|any|do|does|is|are|have|has|please|give me|get me|i d like|i want|let me)\b/

export function classify(utterance: string, c: CaseData): Intent {
  const u = normalise(utterance)
  const hasFindings = matchFindings(utterance, c).length > 0 || matchHistory(utterance, c).length > 0
  if (ANSWER_CUES.test(u) && !REQUEST_START.test(u)) return 'answer'
  if (hasFindings) return 'findings'
  return 'unknown'
}
