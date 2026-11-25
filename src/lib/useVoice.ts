import { useCallback, useEffect, useRef, useState } from 'react'

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking'

/** Browser speech: SpeechRecognition for input, speechSynthesis for the examiner's voice. */
export function useVoice(onFinal: (text: string, endedAt: number) => void) {
  const [state, setState] = useState<VoiceState>('idle')
  const [interim, setInterim] = useState('')
  const recRef = useRef<any>(null)
  const cb = useRef(onFinal)
  cb.current = onFinal
  // Resolved after mount so server and first client render agree (no hydration mismatch).
  const [supported, setSupported] = useState(false)
  useEffect(() => setSupported(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)), [])

  const stopListening = useCallback(() => { try { recRef.current?.abort() } catch {} ; setInterim(''); setState((s) => (s === 'listening' ? 'idle' : s)) }, [])

  const listen = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    window.speechSynthesis?.cancel()
    const rec = new SR()
    rec.lang = 'en-GB'; rec.interimResults = true; rec.continuous = false
    let got = false
    rec.onresult = (e: any) => {
      let t = ''
      for (const r of e.results) t += r[0].transcript
      setInterim(t)
      if (e.results[e.results.length - 1].isFinal && !got) {
        got = true
        const endedAt = performance.now() // timer start: final transcript available
        setInterim(''); setState('thinking'); cb.current(t.trim(), endedAt)
      }
    }
    rec.onerror = () => { if (!got) setState('idle') }
    rec.onend = () => { if (!got) { setInterim(''); setState((s) => (s === 'listening' ? 'idle' : s)) } }
    recRef.current = rec
    try { rec.start(); setState('listening') } catch { setState('idle') } // e.g. mic blocked or already started
  }, [])

  /** Speak; resolves the latency (ms) from `since` to the first audio, then calls onDone when finished. */
  const speak = useCallback((text: string, since: number | null, onDone?: () => void): Promise<number | null> =>
    new Promise((resolve) => {
      const synth = window.speechSynthesis
      if (!synth) { setState('idle'); resolve(null); onDone?.(); return }
      synth.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'en-GB'
      u.onstart = () => { setState('speaking'); resolve(since == null ? null : Math.round(performance.now() - since)) } // timer stop: audio begins
      u.onend = () => { setState('idle'); onDone?.() }
      u.onerror = () => { setState('idle'); resolve(null); onDone?.() }
      synth.speak(u)
    }), [])

  useEffect(() => () => { try { recRef.current?.abort() } catch {} ; window.speechSynthesis?.cancel() }, [])
  return { state, setState, interim, supported, listen, stopListening, speak }
}
