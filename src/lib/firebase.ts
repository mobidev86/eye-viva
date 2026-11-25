import { initializeApp, getApps } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'

const useEmu = import.meta.env.VITE_USE_EMULATOR !== 'false'
const app = getApps()[0] ?? initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'demo-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'demo-eyeviva.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'demo-eyeviva',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? 'demo-app',
})
export const auth = getAuth(app)
export const db = getFirestore(app)
const g = globalThis as any
if (useEmu && !g.__emuConnected) {
  g.__emuConnected = true
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
