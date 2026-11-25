import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { collection, getDocs, query, setDoc, doc, where } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import type { Attempt } from '../lib/types'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const nav = useNavigate()
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState('')
  const [attempts, setAttempts] = useState<{ id: string; a: Attempt }[]>([])

  useEffect(() => onAuthStateChanged(auth, setUser), [])
  useEffect(() => {
    if (!user) { setAttempts([]); return }
    getDocs(query(collection(db, 'attempts'), where('uid', '==', user.uid)))
      .then((s) => setAttempts(s.docs.map((d) => ({ id: d.id, a: d.data() as Attempt })).sort((x, y) => y.a.createdAt - x.a.createdAt)))
      .catch((e) => setErr(String(e.message)))
  }, [user])

  const authAct = (mode: 'in' | 'up') => async () => {
    setErr('')
    try { await (mode === 'in' ? signInWithEmailAndPassword : createUserWithEmailAndPassword)(auth, email, pw) }
    catch (e: any) { setErr(e.code ?? e.message) }
  }
  const start = async () => {
    if (!user) return
    const ref = doc(collection(db, 'attempts'))
    const a: Attempt = { uid: user.uid, caseId: 'EA-VIVA-001', createdAt: Date.now(), phase: 'examine', revealedIds: [], turns: [], followUp: null, revision: null }
    await setDoc(ref, a)
    nav({ to: '/viva/$attemptId', params: { attemptId: ref.id } })
  }

  return (
    <main className="wrap">
      <h1>Eye Academy voice viva</h1>
      <p className="muted">Practice viva on a fictional case. Not clinical guidance.</p>
      {user === undefined ? <div className="skeleton" role="status" aria-label="Loading"><span className="spinner" /><div className="bar w60" /><div className="bar w40" /></div> : !user ? (
        <section className="card">
          <h2>Sign in</h2>
          <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" /></label>
          <label>Password<input value={pw} onChange={(e) => setPw(e.target.value)} type="password" /></label>
          <div className="row"><button onClick={authAct('in')}>Sign in</button><button className="ghost" onClick={authAct('up')}>Create account</button></div>
          {err && <p className="err">{err}</p>}
        </section>
      ) : (
        <>
          <div className="row"><button onClick={start}>Start new viva</button><button className="ghost" onClick={() => signOut(auth)}>Sign out ({user.email})</button></div>
          {err && <p className="err">{err}</p>}
          <h2>Your attempts</h2>
          {!attempts.length && <div className="empty">No attempts yet. Press “Start new viva” to begin.</div>}
          <ul className="attempts">{attempts.map(({ id, a }) => (
            <li key={id}>
              <Link to="/viva/$attemptId" params={{ attemptId: id }} className="attempt">
                <span>
                  <b>{new Date(a.createdAt).toLocaleString()}</b>
                  <small className="muted">{a.revealedIds.length} findings revealed</small>
                </span>
                <span className={`badge b-${a.phase}`}>{a.phase === 'done' ? 'Finished' : a.phase === 'followup' ? 'Follow-up' : 'Examining'}</span>
              </Link>
            </li>
          ))}</ul>
        </>
      )}
    </main>
  )
}
