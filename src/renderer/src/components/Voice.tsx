import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { characterById } from '@shared/characters'
import { useApp } from '../state'
import { DEFAULT_VOICE, listen, LiveSpeaker, record, Speaker } from '../lib/voice'
import { Icon } from './Icon'

let handyInfo: Promise<{ installed: boolean; shortcut: string; model: string }> | null = null
const getHandy = () => (handyInfo ??= window.tide.app.handy())
let flowInfo: Promise<{ installed: boolean; pushToTalk: string }> | null = null
const getFlow = () => (flowInfo ??= window.tide.app.flow())

/** Wispr Flow does the dictation: it types into whatever box has the cursor */
export const useFlow = () => (useApp().settings.voice ?? DEFAULT_VOICE).dictation === 'flow'

/**
 * Hands-free with Wispr Flow: Tide leaves the microphone to Flow and keeps the answer box
 * focused; when Flow finishes putting your words in (one insert of several characters, not your
 * own typing or your own ⌘V) and nothing more comes for a moment, it's sent. Typing yourself holds
 * it back. Listens on the document, so the box can come and go (it's remade for each question).
 */
function watchFlow(box: () => HTMLTextAreaElement | HTMLInputElement | null | undefined, send: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let ownPaste = 0
  const onInput = (e: Event) => {
    const el = box()
    if (!el || e.target !== el) return
    const ev = e as InputEvent
    const pasted = ev.inputType === 'insertFromPaste' && Date.now() - ownPaste > 400
    const bulk = pasted || (ev.inputType === 'insertText' && (ev.data?.length ?? 0) > 2)
    clearTimeout(timer)
    if (bulk) timer = setTimeout(() => el.value.trim() && box() === el && send(), 1200)
  }
  const onKey = (e: Event) => {
    const el = box()
    if (!el || e.target !== el) return
    const k = e as KeyboardEvent
    // Your own ⌘V, or your own typing, means you're writing it yourself
    if ((k.metaKey || k.ctrlKey) && k.key.toLowerCase() === 'v') ownPaste = Date.now()
    else if (!k.metaKey && !k.ctrlKey && k.key.length === 1) clearTimeout(timer)
  }
  document.addEventListener('input', onInput, true)
  document.addEventListener('keydown', onKey, true)
  return () => {
    clearTimeout(timer)
    document.removeEventListener('input', onInput, true)
    document.removeEventListener('keydown', onKey, true)
  }
}

/** The voice: the character's own, at the speed and engine from Settings */
export const useVoicePrefs = () => {
  const { settings } = useApp()
  const v = settings.voice ?? DEFAULT_VOICE
  // A voice you chose in Settings replaces the character's
  return useMemo(() => ({ ...v, name: v.custom || characterById(settings.character).voice }), [v, settings.character])
}

/** Reads text aloud in the tutor's voice */
export function SpeakButton({ text }: { text: string }) {
  const prefs = useVoicePrefs()
  const [speaker, setSpeaker] = useState<Speaker | null>(null)
  useEffect(() => () => speaker?.stop(), [speaker])
  return (
    <button
      className={`icon-btn small speak${speaker ? ' on' : ''}`}
      title={speaker ? 'Stop reading' : 'Read aloud'}
      onClick={() => {
        if (speaker) {
          speaker.stop()
          setSpeaker(null)
          return
        }
        const s = new Speaker(prefs)
        s.onIdle = () => setSpeaker((cur) => (cur === s ? null : cur))
        s.say(text)
        setSpeaker(s)
      }}
    >
      <Icon name={speaker ? 'stop' : 'speaker'} size={13} />
    </button>
  )
}

/**
 * Answer by voice. With Tide's natural voice set up, click to talk and click again to stop: what
 * you said is written out on this Mac and handed back. Otherwise it points to Handy.
 */
export function DictateButton({ target, onText, onStart, where }: { target?: RefObject<HTMLTextAreaElement | HTMLInputElement | null>; onText?: (text: string) => void; onStart?: () => void; where?: { path?: string; topic?: string } }) {
  const { settings } = useApp()
  const [hint, setHint] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'listening' | 'writing'>('idle')
  const [level, setLevel] = useState(0)
  const rec = useRef<Awaited<ReturnType<typeof record>> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const raf = useRef(0)

  useEffect(
    () => () => {
      rec.current?.cancel()
      cancelAnimationFrame(raf.current)
    },
    []
  )

  const say = (text: string) => {
    setHint(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setHint(null), 6000)
  }

  const start = async () => {
    // Handy chosen for dictation (or Tide's model not set up): Handy types into the box instead
    const by = (settings.voice ?? DEFAULT_VOICE).dictation
    if (by === 'flow') {
      target?.current?.focus()
      const f = await getFlow()
      say(f.installed ? `Hold ${f.pushToTalk || 'your Flow key'} and speak: Flow types your words here.` : 'Wispr Flow isn’t installed. Install it, or pick another dictation in Settings › Voice.')
      return
    }
    const deepgram = by === 'deepgram' && (await window.tide.voice.hasDeepgram().catch(() => false))
    const ready = by !== 'handy' && (deepgram || (await window.tide.voice.status().then((s) => s.ready).catch(() => false)))
    if (!ready) {
      target?.current?.focus()
      const h = await getHandy()
      say(h.installed ? `Press ${h.shortcut} and speak. Handy types your words here.` : 'Set up the natural voice in Settings › Voice to answer by speaking.')
      return
    }
    try {
      onStart?.()
      rec.current = await record()
      setState('listening')
      const tick = () => {
        setLevel(rec.current?.level() ?? 0)
        raf.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      say('Tide can’t use the microphone. Allow it in System Settings › Privacy & Security › Microphone.')
    }
  }

  const finish = async () => {
    cancelAnimationFrame(raf.current)
    const r = rec.current
    rec.current = null
    if (!r) return
    setState('writing')
    try {
      const text = (await window.tide.voice.transcribe(await r.stop(), where)).trim()
      if (!text) say('I didn’t catch that. Try again a little closer to the microphone.')
      else if (onText) onText(text)
      else if (target?.current) {
        const el = target.current
        const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
        set?.call(el, (el.value ? el.value.trimEnd() + ' ' : '') + text)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    } catch (e) {
      say((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setState('idle')
    }
  }

  return (
    <span className="dictate">
      <button
        type="button"
        className={`tool-btn dictate-btn is-${state}`}
        title={state === 'listening' ? 'Stop and use what you said' : 'Answer by speaking'}
        onClick={() => (state === 'listening' ? finish() : state === 'idle' ? start() : undefined)}
        disabled={state === 'writing'}
        style={{ ['--level' as string]: level.toFixed(2) }}
      >
        <Icon name={state === 'listening' ? 'stop' : 'mic'} />
        <span>{state === 'listening' ? 'Listening… click to stop' : state === 'writing' ? 'Writing it down…' : 'Speak'}</span>
      </button>
      {hint && <span className="dictate-hint">{hint}</span>}
    </span>
  )
}

/**
 * Talk in a conversation: when on, the tutor speaks each reply as it writes it, and you answer by
 * voice: click the mic, or turn on hands-free and just talk. Space or Esc stops the tutor
 * mid-sentence (as when you interrupt someone). Remembered across conversations.
 */
export function useTalk(latest: { content: string; streaming: boolean; key: string } | null, onText: (text: string) => void, where?: { path?: string; topic?: string }, flowBox?: { box: RefObject<HTMLTextAreaElement | HTMLInputElement | null>; submit: () => void }) {
  const prefs = useVoicePrefs()
  const [talk, setTalk] = useState(() => localStorage.getItem('tide.talk') === 'on')
  const [handsFree, setHandsFree] = useState(() => localStorage.getItem('tide.talk.handsfree') === 'on')
  const [speaking, setSpeaking] = useState(false)
  const [hearing, setHearing] = useState<'off' | 'listening' | 'speech' | 'writing'>('off')
  const live = useRef<{ key: string; speaker: Speaker; live: LiveSpeaker } | null>(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText
  const whereRef = useRef(where)
  whereRef.current = where
  const stop = () => {
    live.current?.speaker.stop()
    live.current = null
    setSpeaking(false)
  }
  useEffect(() => {
    if (talk) window.tide.voice.warm(true).catch(() => {})
    else stop()
  }, [talk])
  useEffect(() => () => stop(), [])

  useEffect(() => {
    if (!talk || !latest || !latest.content) return
    // Only replies written now: opening an old conversation shouldn't read it out
    if (live.current?.key !== latest.key && !latest.streaming) return
    if (live.current?.key !== latest.key) {
      stop()
      const speaker = new Speaker(prefs)
      speaker.onIdle = () => setSpeaking(false)
      live.current = { key: latest.key, speaker, live: new LiveSpeaker(speaker) }
    }
    live.current.live.update(latest.content, !latest.streaming)
    if (live.current.speaker.speaking) setSpeaking(true)
  }, [talk, latest?.key, latest?.content, latest?.streaming, prefs])

  // Interrupt: Space (outside a text field) or Esc stops the voice
  useEffect(() => {
    if (!talk) return
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable="true"]')
      if (e.key === 'Escape' || (e.key === ' ' && !typing)) {
        if (live.current?.speaker.speaking) {
          e.preventDefault()
          stop()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [talk])

  // Hands-free: listen whenever the tutor is neither thinking nor talking
  const listener = useRef<Awaited<ReturnType<typeof listen>> | null>(null)
  const busy = !!latest?.streaming
  const flow = useFlow()
  const flowRef = useRef(flowBox)
  flowRef.current = flowBox
  // With Wispr Flow, Flow listens: Tide keeps the box ready and sends when Flow has typed
  useEffect(() => {
    if (!talk || !handsFree || !flow) return
    setHearing('listening')
    return watchFlow(() => flowRef.current?.box.current, () => flowRef.current?.submit())
  }, [talk, handsFree, flow])
  useEffect(() => {
    if (flow && talk && handsFree && !busy && !speaking) flowRef.current?.box.current?.focus()
  }, [flow, talk, handsFree, busy, speaking])
  useEffect(() => {
    if (!talk || !handsFree || flow) {
      if (!flow || !talk || !handsFree) setHearing('off')
      return
    }
    let live = true
    listen(
      async (wav) => {
        setHearing('writing')
        try {
          const text = (await window.tide.voice.transcribe(wav, whereRef.current)).trim()
          if (live && text.length > 1) onTextRef.current(text)
        } finally {
          if (live) setHearing('listening')
        }
      },
      { onSpeaking: (on) => live && setHearing(on ? 'speech' : 'listening') }
    )
      .then((l) => {
        if (!live) return l.stop()
        listener.current = l
        setHearing('listening')
      })
      .catch(() => {
        setHandsFree(false)
        setHearing('off')
      })
    return () => {
      live = false
      listener.current?.stop()
      listener.current = null
    }
  }, [talk, handsFree, flow])
  useEffect(() => listener.current?.pause(busy || speaking), [busy, speaking])

  const toggle = () =>
    setTalk((v) => {
      localStorage.setItem('tide.talk', v ? 'off' : 'on')
      return !v
    })
  const toggleHandsFree = () =>
    setHandsFree((v) => {
      localStorage.setItem('tide.talk.handsfree', v ? 'off' : 'on')
      return !v
    })
  return { talk, toggle, stop, handsFree, toggleHandsFree, speaking, flow, hearing: busy || speaking ? ('off' as const) : hearing }
}

/** The Talk switch and, when talking, the mic (or hands-free listening) */
export function TalkControls({ voice, onText, where, target }: { voice: ReturnType<typeof useTalk>; onText(text: string): void; where?: { path?: string; topic?: string }; target?: RefObject<HTMLTextAreaElement | HTMLInputElement | null> }) {
  return (
    <>
      <button
        type="button"
        className={`pill${voice.talk ? ' on' : ''}`}
        aria-pressed={voice.talk}
        title={voice.talk ? 'Talking: replies are spoken and you answer by voice. Click to stop.' : 'Talk: hear replies spoken and answer by voice'}
        onClick={voice.toggle}
      >
        <Icon name="speaker" size={13} />
        Talk
      </button>
      {voice.talk && (
        <button
          type="button"
          className={`pill${voice.handsFree ? ' on' : ''} hands-free is-${voice.hearing}`}
          aria-pressed={voice.handsFree}
          title={voice.flow ? (voice.handsFree ? 'Hands-free with Wispr Flow: speak with Flow; what it types is sent when it finishes. Space or Esc interrupts the tutor.' : 'Hands-free: what Wispr Flow types is sent when it finishes') : voice.handsFree ? 'Hands-free: just talk; Tide hears when you stop. Space or Esc interrupts the tutor.' : 'Hands-free: no clicking, just talk'}
          onClick={voice.toggleHandsFree}
        >
          <span className="hear-dot" aria-hidden="true" />
          {voice.handsFree ? (voice.speaking ? 'Speaking… (Esc)' : voice.flow ? 'Flow: sends when done' : voice.hearing === 'speech' ? 'Hearing you…' : voice.hearing === 'writing' ? 'Writing it down…' : 'Listening') : 'Hands-free'}
        </button>
      )}
      {voice.talk && !voice.handsFree && <DictateButton onStart={voice.stop} onText={voice.flow ? undefined : onText} target={target} where={where} />}
    </>
  )
}
