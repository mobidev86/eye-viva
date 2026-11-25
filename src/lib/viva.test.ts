import { describe, expect, it } from 'vitest'
import caseJson from '../../data/case.json'
import note from '../../data/note-chunks.json'
import type { CaseData } from './types'
import { examinerTurn } from './viva'
import { KEY_POINTS, FALLBACK_STRENGTHEN, buildRevision, citationIsVerbatim, findSupport, supportFor } from './retrieval'

const c = caseJson as unknown as CaseData
const idx = note as any

describe('check 1: available finding keeps eye, value, unit', () => {
  it('right IOP', () => {
    const r = examinerTurn(c, 'What is the pressure in the right eye?')
    expect(r.kind).toBe('findings')
    if (r.kind !== 'findings') return
    expect(r.revealed.map((x) => [x.id, x.display])).toEqual([['iop_right', '58 mmHg']])
    expect(r.spoken).toContain('Right eye')
    expect(r.spoken).toContain('58 millimetres of mercury')
  })
  it('no eye named -> both eyes, not mixed up', () => {
    const r = examinerTurn(c, 'visual acuity')
    if (r.kind !== 'findings') throw new Error()
    expect(r.revealed.map((x) => [x.eye, x.display])).toEqual([['right', '6/36 Snellen'], ['left', '6/9 Snellen']])
    expect(r.spoken).toContain('6 over 36')
  })
})

describe('check 2: unavailable finding is stated, never invented', () => {
  it.each([
    ['gonioscopy of the right eye', 'gonio_right', 'No view: corneal oedema'],
    ['Can I see an OCT', 'oct', 'Not performed in casualty'],
    ['any RAPD?', 'rapd', 'Right pupil fixed'],
  ])('%s', (q, id, reason) => {
    const r = examinerTurn(c, q)
    if (r.kind !== 'findings') throw new Error(r.kind)
    const f = r.revealed.find((x) => x.id === id)!
    expect(f.available).toBe(false)
    expect(f.display).toBeNull()
    expect(f.reason).toContain(reason)
    expect(r.spoken).toMatch(/not available/i)
  })
})

describe('check 3: revision citation is supported by the note', () => {
  it('missing sulfonamide check -> cites p5/6 verbatim', () => {
    const rev = buildRevision(idx, 'acute angle closure. i would give timolol drops, analgesia, acetazolamide and laser iridotomy to both eyes, stop the chlorphenamine')
    expect(rev.supported).toBe(true)
    if (!rev.supported) return
    expect(rev.citation.excerpt.toLowerCase()).toContain('sulfonamide allergy')
    expect([5, 6]).toContain(rev.citation.page)
    expect(citationIsVerbatim(idx, rev.citation)).toBe(true)
  })
  it('refuses when the note has no support', () => {
    const { citation } = findSupport(idx, 'intravitreal dexamethasone implant dose', [/dexamethasone/i])
    expect(citation).toBeNull()
  })
})

describe('intent and follow-up', () => {
  it('a finding request is not mistaken for an answer', () => {
    expect(examinerTurn(c, 'Can I see the angle on gonioscopy?').kind).toBe('findings')
  })
  it('a diagnosis statement is treated as an answer and gets exactly one question', () => {
    const r = examinerTurn(c, 'I think this is acute angle closure, I would give timolol and acetazolamide')
    expect(r.kind).toBe('followup')
    if (r.kind === 'followup') expect(r.question.split('?').length - 1).toBe(1)
  })
  it('acetazolamide without an allergy check prompts the allergy question', () => {
    const r = examinerTurn(c, 'Acute angle closure, give acetazolamide and laser iridotomy to both eyes', false)
    expect(r.kind === 'followup' && r.question).toMatch(/acetazolamide/i)
  })
  it('no diagnosis named prompts for one', () => {
    const r = examinerTurn(c, 'I would start some drops', true)
    expect(r.kind === 'followup' && r.question).toMatch(/diagnosis/i)
  })
  it('gibberish is not invented into a finding', () => {
    expect(examinerTurn(c, 'banana smoothie').kind).toBe('unknown')
  })
})

describe('revision: every key point is supported from the acute-attack pages, with a short verbatim excerpt', () => {
  const expectPage: Record<string, number[]> = {
    sulfonamide: [6], fellow: [6], trigger: [6], pilocarpine: [5], analgesia: [5], topical: [5],
  }
  for (const k of [...KEY_POINTS, { id: 'fallback', ...FALLBACK_STRENGTHEN }] as any[]) {
    it(k.id, () => {
      const { citation, retrievedPages } = supportFor(idx, k)
      expect(citation, 'no support found').not.toBeNull()
      expect(retrievedPages.every((p) => p >= 3 && p <= 7)).toBe(true) // never the distractor sections
      expect(citation!.excerpt.length).toBeLessThanOrEqual(300)
      expect(citationIsVerbatim(idx, citation!)).toBe(true)
      if (expectPage[k.id]) expect(expectPage[k.id]).toContain(citation!.page)
    })
  }
  it('fellow-eye point is reached when everything before it is covered', () => {
    const rev = buildRevision(idx, 'angle closure, check sulfonamide allergy before acetazolamide, timolol drops, analgesia')
    expect(rev.supported).toBe(true)
    if (rev.supported) { expect(rev.citation.excerpt).toMatch(/fellow eye/i); expect(rev.citation.page).toBe(6) }
  })
  it('topical point cites page 5, not the page 9 drug table', () => {
    const rev = buildRevision(idx, 'angle closure; allergy checked; both eyes laser iridotomy; stop chlorphenamine; pilocarpine once pressure falls; analgesia')
    expect(rev.supported && rev.citation.page).toBe(5)
    expect(rev.supported && rev.citation.excerpt).toMatch(/timolol/i)
  })
})

describe('history and matcher edge cases', () => {
  const ids = (q: string) => { const r = examinerTurn(c, q); return r.kind === 'findings' ? r.revealed.map((x) => x.id) : [r.kind] }
  it('allergies and medications are answerable from the patient record', () => {
    expect(ids('Does she have any allergies?')).toEqual(['hx_allergies'])
    const r = examinerTurn(c, 'What medications is she taking?')
    if (r.kind !== 'findings') throw new Error()
    expect(r.revealed[0].display).toContain('Chlorphenamine 4 mg')
  })
  it('"history" alone returns all six history items', () => {
    expect(ids('What is her history?')).toHaveLength(6)
  })
  it('blood pressure is not intraocular pressure, and vice versa', () => {
    expect(ids('What is the blood pressure?')).toEqual(['bp'])
    expect(ids('pressure in the left eye')).toEqual(['iop_left'])
  })
  it('U&E in every common spoken/written form', () => {
    for (const q of ['What are the U&Es?', 'u and e', 'U and Es', 'any bloods', 'urea and electrolytes']) expect(ids(q), q).toEqual(['u_and_e'])
  })
  it('afferent pupil phrasing gives RAPD only, not the pupil exam', () => {
    expect(ids('is there an afferent pupil defect')).toEqual(['rapd'])
    expect(ids('relative afferent pupillary defect')).toEqual(['rapd'])
    expect(ids('what do the pupils look like')).toEqual(['pupil_right', 'pupil_left'])
  })
  it('an answer that mentions allergy is still an answer', () => {
    expect(examinerTurn(c, 'I would give acetazolamide after checking her allergies').kind).toBe('followup')
  })
})

describe('every finding in the case file is returned faithfully', () => {
  const ask: Record<string, string> = {
    va: 'visual acuity', iop: 'intraocular pressure', conj: 'conjunctiva', cornea: 'cornea', ac: 'anterior chamber depth',
    pupil: 'pupils', rapd: 'rapd', lens: 'lens', gonio: 'gonioscopy', fundus: 'optic disc and fundus',
    refraction: 'refraction', axial_length: 'axial length', oct: 'oct', bp: 'blood pressure', u_and_e: 'urea and electrolytes',
  }
  for (const f of c.findings) {
    it(`${f.id}`, () => {
      const base = f.id.replace(/_(right|left)$/, '')
      const eye = f.eye === 'right' || f.eye === 'left' ? ` ${f.eye} eye` : ''
      const r = examinerTurn(c, `${ask[base]}${eye}`)
      if (r.kind !== 'findings') throw new Error(`not recognised: ${f.id}`)
      const got = r.revealed.find((x) => x.id === f.id)
      expect(got, 'finding missing').toBeTruthy()
      expect(got!.eye).toBe(f.eye)
      expect(got!.available).toBe(f.available)
      if (f.available) {
        expect(got!.display).toContain(String(f.value)) // exact value
        if (f.unit) expect(got!.display).toContain(f.unit) // exact unit
        expect(got!.display).not.toBeNull()
      } else {
        expect(got!.display).toBeNull() // never invent a value
        expect(got!.reason).toBe(f.unavailable_reason)
      }
      // The eye named in the request never returns the other eye's finding.
      if (f.eye === 'right' || f.eye === 'left') expect(r.revealed.every((x) => x.eye === f.eye || x.eye === null || x.eye === 'both')).toBe(true)
    })
  }
  it('opening prompt and case ids match the client file', () => {
    expect(c.case_id).toBe('EA-VIVA-001')
    expect(c.findings).toHaveLength(24)
  })
})
