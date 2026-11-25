import type { Citation, Revision } from './types'
import { normalise } from './findings'

export type Chunk = { id: string; page: number; section: string; text: string }
export type NoteIndex = { pages: { page: number; text: string }[]; chunks: Chunk[] }

const STOP = new Set(
  'a an and are as at be by for from has have in is it of on or that the this to was with not no but if then than so can may which who when into'.split(
    ' ',
  ),
)
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '')
export const tokens = (s: string) =>
  normalise(s)
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map(stem)

/** Small BM25 over the pre-chunked note. */
export function search(index: NoteIndex, query: string, k = 4, pages?: number[]): Array<{ chunk: Chunk; score: number }> {
  const q = tokens(query)
  const docs = index.chunks.map((c) => tokens(c.text + ' ' + c.section))
  const N = docs.length
  const avg = docs.reduce((a, d) => a + d.length, 0) / N
  const df = new Map<string, number>()
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
  const k1 = 1.4
  const b = 0.75
  return index.chunks
    .map((chunk, i) => {
      const d = docs[i]
      let score = 0
      for (const t of new Set(q)) {
        const f = d.filter((x) => x === t).length
        if (!f) continue
        const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5))
        score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg))
      }
      return { chunk, score }
    })
    .filter((r) => r.score > 0 && (!pages || pages.includes(r.chunk.page)))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

/** Pages of the acute primary angle closure material (the case file names it the main source; other pages are distractors). */
export const MAIN_PAGES = [3, 4, 5, 6, 7]

/** Bullets and table rows have no full stops, so a "sentence" can be a whole list. Keep a short verbatim window around the match. */
export function tightExcerpt(sent: string, must: RegExp[], max = 280): string {
  if (sent.length <= max) return sent
  const m = must.map((re) => re.exec(sent)).find(Boolean)!
  const at = m.index
  let start = Math.max(0, at - 30)
  let end = Math.min(sent.length, at + m[0].length + 200)
  if (start > 0) start = sent.indexOf(' ', start) + 1 || start
  if (end < sent.length) end = sent.lastIndexOf(' ', end) > at ? sent.lastIndexOf(' ', end) : end
  return sent.slice(start, end).trim()
}

const sentences = (t: string) => t.split(/(?<=[.;])\s+(?=[A-Z0-9])/).map((s) => s.trim()).filter(Boolean)

/**
 * Find a supporting excerpt: the best-scoring sentence, among retrieved chunks, that contains
 * EVERY `must` pattern. If none does, there is no support - never fall back to a loosely related passage.
 */
export function findSupport(
  index: NoteIndex,
  query: string,
  must: RegExp[],
  pages: number[] = MAIN_PAGES,
): { citation: Citation | null; retrievedPages: number[] } {
  const hits = search(index, query, 6, pages)
  const retrievedPages = [...new Set(hits.map((h) => h.chunk.page))]
  const qt = new Set(tokens(query))
  let best: { cit: Citation; s: number } | null = null
  for (const h of hits) {
    for (const sent of sentences(h.chunk.text)) {
      if (!must.every((re) => re.test(sent))) continue
      const s = tokens(sent).filter((t) => qt.has(t)).length + h.score / 100
      if (!best || s > best.s)
        best = { s, cit: { page: h.chunk.page, section: h.chunk.section, excerpt: tightExcerpt(sent, must), chunkId: h.chunk.id } }
    }
  }
  return { citation: best?.cit ?? null, retrievedPages }
}

/** The excerpt must be literally present on the cited page (guards against paraphrase/hallucination). */
export function citationIsVerbatim(index: NoteIndex, c: Citation): boolean {
  const page = index.pages.find((p) => p.page === c.page)
  return !!page && page.text.includes(c.excerpt)
}

type KeyPoint = {
  id: string
  /** Trainee covered this if the transcript matches. */
  covered: RegExp
  lead: string
  query: string
  must: RegExp[]
}

// Ordered by clinical priority. `covered` is checked against the trainee's own answers only.
export const KEY_POINTS: KeyPoint[] = [
  {
    id: 'sulfonamide',
    covered: /\b(sulfa|sulpha|sulfonamide|allerg\w*)\b/,
    lead: 'You did not mention checking her sulfonamide allergy before acetazolamide.',
    query: 'acetazolamide check sulfonamide allergy kidney disease before giving',
    must: [/check for sulfonamide allergy/i, /before giving/i],
  },
  {
    id: 'fellow',
    covered: /\b(left|fellow|other eye|both eyes|prophyla\w*|bilateral)\b.*\b(iridotomy|lpi|laser)\b|\b(iridotomy|lpi|laser)\b.*\b(left|fellow|other eye|both eyes|bilateral)\b/,
    lead: 'You did not say the other (left) eye needs an iridotomy too.',
    query: 'prophylactic laser peripheral iridotomy fellow eye attack within years',
    must: [/fellow eye/i, /\b(LPI|iridotomy)\b/],
  },
  {
    id: 'trigger',
    covered: /\b(stop|withdraw|discontinue|avoid)\w*\b.*\b(chlorphenamine|antihistamine|piriton)\b|\b(chlorphenamine|antihistamine)\b.*\b(stop|withdraw|trigger)\w*/,
    lead: 'You did not mention stopping the chlorphenamine trigger.',
    query: 'any trigger drug should be stopped patient warned about others',
    must: [/trigger drug should be stopped/i],
  },
  {
    id: 'pilocarpine',
    covered: /\b(pilocarpine)\b.*\b(once|after|when|until|wait|fall\w*|sphincter|ischaemi\w*)\b/,
    lead: 'On pilocarpine: timing matters when the pressure is very high.',
    query: 'pilocarpine iris sphincter ischaemic does not respond while IOP very high',
    must: [/pilocarpine/i, /sphincter/i],
  },
  {
    id: 'analgesia',
    covered: /\b(analgesi\w*|antiemetic|anti emetic|painkiller|ondansetron|cyclizine|paracetamol)\b/,
    lead: 'You did not mention analgesia and an antiemetic.',
    query: 'position support lie flat analgesia antiemetic',
    must: [/analgesia/i, /antiemetic/i],
  },
  {
    id: 'topical',
    covered: /\b(timolol|beta ?blocker|apraclonidine|brimonidine|alpha|drops?|topical)\b/,
    lead: 'You did not mention topical pressure-lowering drops.',
    query: 'topical IOP-lowering drops beta-blocker timolol alpha-agonist apraclonidine',
    must: [/timolol/i],
  },
]

export const FALLBACK_STRENGTHEN = {
  lead: 'Good coverage. One thing to consolidate: what to do when pressure will not fall.',
  query: 'if the IOP does not fall early laser iridotomy iridoplasty paracentesis',
  must: [/Laser peripheral iridoplasty/i],
}

export function supportFor(index: NoteIndex, k: { query: string; must: RegExp[] }) {
  return findSupport(index, k.query, k.must)
}

export function buildRevision(index: NoteIndex, trainee: string): Revision {
  const u = normalise(trainee)
  const missed = KEY_POINTS.find((k) => !k.covered.test(u))
  const target = missed ?? FALLBACK_STRENGTHEN
  const { citation, retrievedPages } = supportFor(index, target)
  if (!citation || !citationIsVerbatim(index, citation))
    return {
      supported: false,
      message:
        'I could not find support for a revision point in the reference note, so I will not give you one. Check this topic against your local protocol.',
      retrievedPages,
    }
  return { supported: true, point: `${target.lead} The note says it directly.`, citation, retrievedPages }
}
