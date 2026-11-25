// Runs the real client SDK against the Auth + Firestore emulators, so it exercises firestore.rules end to end.
import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth'
import { connectFirestoreEmulator, doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc, getFirestore } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'

function client(name: string) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: 'demo-eyeviva', appId: name }, name)
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080)
  return { auth, db }
}
const denied = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 'permission-denied' })

describe('attempts are private to their owner', () => {
  const alice = client('alice'), bob = client('bob'), anon = client('anon')
  const a = (uid: string) => ({ uid, caseId: 'EA-VIVA-001', turns: [], phase: 'examine' })

  it('owner can create, read, update; list only returns own', async () => {
    const u = (await createUserWithEmailAndPassword(alice.auth, 'alice@example.com', 'secret123')).user
    await setDoc(doc(alice.db, 'attempts/x1'), a(u.uid))
    expect((await getDoc(doc(alice.db, 'attempts/x1'))).data()?.uid).toBe(u.uid)
    await updateDoc(doc(alice.db, 'attempts/x1'), { phase: 'followup' })
    const own = await getDocs(query(collection(alice.db, 'attempts'), where('uid', '==', u.uid)))
    expect(own.size).toBe(1)
  })
  it('another signed-in user cannot read, list or modify it', async () => {
    const u = (await createUserWithEmailAndPassword(bob.auth, 'bob@example.com', 'secret123')).user
    await denied(getDoc(doc(bob.db, 'attempts/x1')))
    await denied(updateDoc(doc(bob.db, 'attempts/x1'), { phase: 'done' }))
    await denied(getDocs(collection(bob.db, 'attempts'))) // unfiltered list is rejected
    await denied(setDoc(doc(bob.db, 'attempts/x2'), a('someone-else'))) // cannot create under another uid
    expect(u.uid).toBeTruthy()
  })
  it('signed-out user cannot read', async () => {
    await signOut(anon.auth)
    await denied(getDoc(doc(anon.db, 'attempts/x1')))
  })
})
