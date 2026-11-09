import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { characterById } from '@shared/characters'
import { useApp } from '../state'
import { DEFAULT_VOICE, listen, LiveSpeaker, record, Speaker } from '../lib/voice'
import { Icon } from './Icon'

let handyInfo: Promise<{ installed: boolean; shortcut: string; model: string }> | null = null
const getHandy = () => (handyInfo ??= window.tide.app.handy())

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
export function DictateButton({ target, onText, onStart }: { target?: RefObject<HTMLTextAreaElement | HTMLInputElement | null>; onText?: (text: string) => void; onStart?: () => void }) {
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
    const viaHandy = (settings.voice ?? DEFAULT_VOICE).dictation === 'handy'
    const ready = !viaHandy && (await window.tide.voice.status().then((s) => s.ready).catch(() => false))
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
      const text = (await window.tide.voice.transcribe(await r.stop())).trim()
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
export function useTalk(latest: { content: string; streaming: boolean; key: string } | null, onText: (text: string) => void) {
  const prefs = useVoicePrefs()
  const [talk, setTalk] = useState(() => localStorage.getItem('tide.talk') === 'on')
  const [handsFree, setHandsFree] = useState(() => localStorage.getItem('tide.talk.handsfree') === 'on')
  const [speaking, setSpeaking] = useState(false)
  const [hearing, setHearing] = useState<'off' | 'listening' | 'speech' | 'writing'>('off')
  const live = useRef<{ key: string; speaker: Speaker; live: LiveSpeaker } | null>(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText
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
  useEffect(() => {
    if (!talk || !handsFree) {
      setHearing('off')
      return
    }
    let live = true
    listen(
      async (wav) => {
        setHearing('writing')
        try {
          const text = (await window.tide.voice.transcribe(wav)).trim()
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
  }, [talk, handsFree])
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
  return { talk, toggle, stop, handsFree, toggleHandsFree, speaking, hearing: busy || speaking ? ('off' as const) : hearing }
}

/** The Talk switch and, when talking, the mic (or hands-free listening) */
export function TalkControls({ voice, onText }: { voice: ReturnType<typeof useTalk>; onText(text: string): void }) {
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
          title={voice.handsFree ? 'Hands-free: just talk; Tide hears when you stop. Space or Esc interrupts the tutor.' : 'Hands-free: no clicking, just talk'}
          onClick={voice.toggleHandsFree}
        >
          <span className="hear-dot" aria-hidden="true" />
          {voice.handsFree ? (voice.hearing === 'speech' ? 'Hearing you…' : voice.hearing === 'writing' ? 'Writing it down…' : voice.speaking ? 'Speaking… (Esc)' : 'Listening') : 'Hands-free'}
        </button>
      )}
      {voice.talk && !voice.handsFree && <DictateButton onStart={voice.stop} onText={onText} />}
    </>
  )
}
