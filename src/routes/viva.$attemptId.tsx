import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { getCase, takeTurn, makeRevision } from '../server/viva'
import { useVoice } from '../lib/useVoice'
import type { Attempt, RevealedFinding, Turn } from '../lib/types'

export const Route = createFileRoute('/viva/$attemptId')({ component: Viva })

const LABEL = { idle: 'Idle', listening: 'Your turn: speak now', thinking: 'Examiner is thinking…', speaking: 'Examiner is speaking' } as const

function Viva() {
  const { attemptId } = Route.useParams()
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [findings, setFindings] = useState<Record<string, RevealedFinding>>({})
  const [err, setErr] = useState('')
  const [typed, setTyped] = useState('')
  const [hands, setHands] = useState(true)
  const ref = useRef<Attempt | null>(null)
  const findingsRef = useRef(findings); findingsRef.current = findings
  const handsRef = useRef(hands); handsRef.current = hands
  const answerMode = useRef(false) // set by the "ready to give my diagnosis" button: the next utterance is the answer
  const logRef = useRef<HTMLOListElement>(null)
  // Keep the newest exchange in view as the transcript grows.
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }) }, [attempt?.turns.length])

  // Writes are serialised and always persist the latest snapshot, so a slow earlier turn can never clobber a later one.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const revealedRef = useRef<Record<string, RevealedFinding>>({})
  const save = useCallback((a: Attempt, f: Record<string, RevealedFinding>) => {
    ref.current = a; revealedRef.current = f; setAttempt(a)
    queue.current = queue.current.then(() =>
      setDoc(doc(db, 'attempts', attemptId), JSON.parse(JSON.stringify({ ...ref.current!, revealed: revealedRef.current }))), // JSON round-trip drops undefined, which Firestore rejects
    ).catch((e) => setErr(String(e.message)))
    return queue.current
  }, [attemptId])
  /** Record time-to-first-audio on the examiner turn identified by `at`, whatever has been added since. */
  const patchLatency = useCallback((at: number, ms: number | null) => {
    const cur = ref.current; if (!cur || ms == null) return
    return save({ ...cur, turns: cur.turns.map((t) => (t.role === 'examiner' && t.at === at ? { ...t, latencyMs: ms } : t)) }, revealedRef.current)
  }, [save])

  const handle = useCallback(async (text: string, endedAt: number) => {
    const a = ref.current; if (!a || !text) return
    const trainee: Turn = { role: 'trainee', text, at: Date.now() }
    try {
      if (a.phase === 'examine') {
        const force = answerMode.current; answerMode.current = false
        const r = await takeTurn({ data: { utterance: text, forceAnswer: force } })
        let next: Attempt, f = findingsRef.current, say = r.spoken
        if (r.kind === 'findings') {
          f = { ...f, ...Object.fromEntries(r.revealed.map((x) => [x.id, x])) }
          setFindings(f)
          next = { ...a, revealedIds: [...new Set([...a.revealedIds, ...r.revealed.map((x) => x.id)])], turns: [...a.turns, trainee] }
        } else if (r.kind === 'followup') {
          next = { ...a, phase: 'followup', followUp: r.question, turns: [...a.turns, { ...trainee, tag: 'answer' }] }
        } else next = { ...a, turns: [...a.turns, trainee] }
        const ex: Turn = { role: 'examiner', text: say, at: Date.now(), findingIds: r.kind === 'findings' ? r.revealed.map((x) => x.id) : undefined, latencyMs: null }
        // show text immediately, then speak and record time-to-first-audio
        await save({ ...next, turns: [...next.turns, ex] }, f)
        const ms = await voice.speak(say, endedAt, () => { if (handsRef.current && !(next.phase === 'done')) voice.listen() })
        await patchLatency(ex.at, ms)
      } else if (a.phase === 'followup') {
        const withReply = { ...a, turns: [...a.turns, { ...trainee, tag: 'reply' as const }] }
        const answers = withReply.turns.filter((t) => t.tag).map((t) => t.text)
        const rev = await makeRevision({ data: { answers } })
        const say = rev.supported ? `Revision point. ${rev.point} See page ${rev.citation.page} of the reference note.` : rev.message
        const ex: Turn = { role: 'examiner', text: say, at: Date.now(), latencyMs: null }
        await save({ ...withReply, phase: 'done', revision: rev, turns: [...withReply.turns, ex] }, findingsRef.current)
        const ms = await voice.speak(say, endedAt)
        await patchLatency(ex.at, ms)
      }
    } catch (e: any) { setErr(e.message); voice.setState('idle') }
  }, [save, patchLatency])

  const voice = useVoice(handle)

  useEffect(() => onAuthStateChanged(auth, setUser), [])
  useEffect(() => {
    if (!user) return
    getDoc(doc(db, 'attempts', attemptId)).then(async (s) => {
      if (!s.exists()) return setErr('Attempt not found')
      const d = s.data() as Attempt & { revealed?: Record<string, RevealedFinding> }
      ref.current = d; setAttempt(d); setFindings(d.revealed ?? {})
      if (!d.turns.length) {
        const c = await getCase()
        const ex: Turn = { role: 'examiner', text: c.openingPrompt, at: Date.now() }
        await save({ ...d, turns: [ex] }, {})
        voice.speak(c.openingPrompt, null, () => { if (handsRef.current) voice.listen() })
      }
    }).catch((e) => setErr(e.code === 'permission-denied' ? 'This attempt is private to its owner.' : e.message))
  }, [user, attemptId])

  const submitTyped = () => { const t = typed.trim(); if (!t) return; setTyped(''); voice.setState('thinking'); handle(t, performance.now()) }
  const forceAnswer = async () => {
    const a = ref.current; if (!a || a.phase !== 'examine') return
    voice.stopListening()
    const t = typed.trim()
    answerMode.current = true
    if (t) { setTyped(''); voice.setState('thinking'); await handle(t, performance.now()); return }
    // Nothing typed: invite the answer, then treat whatever they say next as their diagnosis and management.
    const say = 'Go ahead: give me your diagnosis and immediate management.'
    const ex: Turn = { role: 'examiner', text: say, at: Date.now() }
    await save({ ...a, turns: [...a.turns, ex] }, revealedRef.current)
    voice.speak(say, null, () => voice.listen())
  }

  if (user === undefined) return <main className="wrap"><div className="skeleton" role="status" aria-label="Loading"><span className="spinner" /><div className="bar w60" /><div className="bar w40" /></div></main>
  if (!user) return <main className="wrap"><p>Please <Link to="/">sign in</Link>.</p></main>
  const done = attempt?.phase === 'done'
  const lat = attempt?.turns.filter((t) => t.latencyMs != null).map((t) => t.latencyMs!) ?? []

  return (
    <main className="wrap two">
      <section>
        <p><Link to="/">← All attempts</Link></p>
        <h1>Case EA-VIVA-001</h1>
        <p className="muted">Fictional case. Phase: <b>{attempt?.phase ?? '…'}</b></p>
        <div className={`status s-${voice.state}`} role="status" aria-live="polite">
          <span className="dot" /> {done ? 'Viva finished' : LABEL[voice.state]}
        </div>
        {!voice.supported && <p className="err">Speech recognition is not supported in this browser (use Chrome or Edge). Type instead.</p>}
        {err && <p className="err">{err}</p>}
        {!done && (
          <div className="controls">
            <button onClick={voice.state === 'listening' ? voice.stopListening : voice.listen} disabled={!voice.supported || voice.state === 'thinking'}>
              {voice.state === 'listening' ? '■ Stop mic' : 'Speak (mic)'}
            </button>
            {attempt?.phase === 'examine' && <button className="ghost" onClick={forceAnswer}>I’m ready to give my diagnosis</button>}
            <label className="inline"><input type="checkbox" checked={hands} onChange={(e) => setHands(e.target.checked)} /> Auto-listen after examiner</label>
            <div className="row"><input aria-label="Type your request" placeholder="…or type here" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitTyped()} /><button className="ghost" onClick={submitTyped}>Send</button></div>
            {voice.interim && <p className="interim">“{voice.interim}”</p>}
          </div>
        )}
        <h2>Transcript</h2>
        <ol className="transcript" ref={logRef} aria-label="Transcript" tabIndex={0}>{attempt?.turns.map((t, i) => (
          <li key={i} className={t.role}><b>{t.role === 'examiner' ? 'Examiner' : 'You'}:</b> {t.text}
            {t.latencyMs != null && <small className="muted"> · {t.latencyMs} ms to first audio</small>}</li>
        ))}</ol>
        {lat.length > 0 && <p className="muted">Median voice-turn latency: {[...lat].sort((a, b) => a - b)[Math.floor(lat.length / 2)]} ms (final transcript → first audio)</p>}
        {attempt?.revision && (
          <div className="card rev">
            <h2>Revision point</h2>
            {attempt.revision.supported ? (<>
              <p>{attempt.revision.point}</p>
              <blockquote>“{attempt.revision.citation.excerpt}”<footer>Reference note, page {attempt.revision.citation.page} ({attempt.revision.citation.section})</footer></blockquote>
              <small className="muted">Pages retrieved: {attempt.revision.retrievedPages.join(', ')}</small>
            </>) : <p className="err">{attempt.revision.message}</p>}
          </div>
        )}
      </section>
      <aside>
        <h2>Findings revealed</h2>
        {!Object.keys(findings).length && <p className="muted">Ask for a finding aloud, e.g. “What is the pressure in the right eye?”</p>}
        {Object.values(findings).map((f) => (
          <div key={f.id} className={`finding ${f.available ? '' : 'na'}`}>
            <span className={`eye eye-${f.eye ?? 'gen'}`}>{f.eye ? f.eye.toUpperCase() : 'GENERAL'}</span>
            <div><b>{f.label}</b></div>
            <div className="val">{f.available ? f.display : `Not available: ${f.reason}`}</div>
            {f.method && <small className="muted">{f.method}</small>}
          </div>
        ))}
      </aside>
    </main>
  )
}
