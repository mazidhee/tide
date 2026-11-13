import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { dragCrop, MAX_ZOOM, MIN_ZOOM, previewBox, zoomCrop } from '@shared/avatarCrop'
import { greetingName, initials, type Crop, type PictureChoice, type Profile } from '@shared/profile'
import { MAX_COLOURS, MIN_COLOURS, paintPixel, pixelise, SIZES, toggleEye, withColour, type PixelSprite } from '@shared/pixelise'
import { adoptProfile, updateProfile, useProfile } from '../lib/profile'
import { fileToSource, framedPhoto, framedPixels, loadImage, videoToSource } from '../lib/photo'
import { useApp } from '../state'
import { Avatar, PixelSelf } from './Avatar'
import { Icon } from './Icon'
import { PillSegment } from './PromptBox'
import { Group, Row, Toggle } from './SettingsView'

/** The crop circle's diameter on screen */
const STAGE = 208

type Tool = { kind: 'paint'; colour: number } | { kind: 'erase' } | { kind: 'eye' }
type Options = { size: number; colours: number; background: boolean }

const DEFAULT_OPTIONS: Options = { size: 32, colours: 10, background: false }
const errorText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** A text setting saved when you leave the field or press Return */
function TextField({ value, onSave, label, placeholder, wide }: { value: string; onSave(v: string): void; label: string; placeholder?: string; wide?: boolean }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      className={`set-input${wide ? ' wide' : ''}`}
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onSave(draft.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

/** Your camera, mirrored in the circle, until you take the picture */
function Camera({ onTake, onCancel }: { onTake(dataUrl: string): void; onCancel(): void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let stream: MediaStream | null = null
    let gone = false
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 960 }, facingMode: 'user' }, audio: false })
      .then((s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop())
        stream = s
        if (video.current) video.current.srcObject = s
      })
      .catch(() => setError('Tide couldn’t open the camera. You can allow it in System Settings › Privacy & Security › Camera.'))
    return () => {
      gone = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])
  return (
    <div className="pf-camera">
      <div className="pf-stage" style={{ width: STAGE, height: STAGE }}>
        <video ref={video} autoPlay playsInline muted />
      </div>
      {error ? <p className="set-hint pf-error">{error}</p> : <p className="set-hint">Only this picture is kept, on this Mac.</p>}
      <div className="pf-actions">
        <button className="btn small primary" disabled={!!error} onClick={() => video.current?.videoWidth && onTake(videoToSource(video.current))}>
          <Icon name="camera" size={14} />
          Take the picture
        </button>
        <button className="btn small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** The photo behind a circle: drag to move it, the slider or the scroll wheel to zoom */
function CropStage({ img, crop, onCrop, onDone }: { img: HTMLImageElement; crop: Crop; onCrop(c: Crop): void; onDone(): void }) {
  const last = useRef<{ x: number; y: number } | null>(null)
  const w = img.naturalWidth
  const h = img.naturalHeight
  const box = previewBox(w, h, crop, STAGE)
  const down = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    last.current = { x: e.clientX, y: e.clientY }
  }
  const move = (e: ReactPointerEvent) => {
    if (!last.current) return
    const dx = e.clientX - last.current.x
    const dy = e.clientY - last.current.y
    last.current = { x: e.clientX, y: e.clientY }
    onCrop(dragCrop(w, h, crop, dx, dy, STAGE))
  }
  const up = () => {
    if (!last.current) return
    last.current = null
    onDone()
  }
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 20 : 6
    const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
    if (!d) return
    e.preventDefault()
    onCrop(dragCrop(w, h, crop, d[0], d[1], STAGE))
    onDone()
  }
  return (
    <div className="pf-crop">
      <div
        className="pf-stage pf-drag"
        style={{ width: STAGE, height: STAGE }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(e) => {
          onCrop(zoomCrop(w, h, crop, crop.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)))
          onDone()
        }}
        tabIndex={0}
        role="group"
        aria-label="Photo framing: drag or use the arrow keys to move it"
        onKeyDown={key}
      >
        <img src={img.src} alt="" draggable={false} style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />
      </div>
      <label className="pf-zoom">
        <span className="pf-zoom-icon small" aria-hidden="true" />
        <input type="range" className="set-range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={crop.zoom} aria-label="Zoom" onChange={(e) => onCrop(zoomCrop(w, h, crop, Number(e.target.value)))} onPointerUp={onDone} onKeyUp={onDone} />
        <span className="pf-zoom-icon" aria-hidden="true" />
      </label>
    </div>
  )
}

/** The sprite, big, with its pixels to click: paint, erase, or mark the eyes */
function PixelCanvas({ sprite, tool, onStroke, onPaint }: { sprite: PixelSprite; tool: Tool; onStroke(): void; onPaint(i: number): void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const painting = useRef(false)
  const cell = Math.max(6, Math.floor(304 / sprite.size))
  const side = cell * sprite.size

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const dpr = window.devicePixelRatio || 1
    el.width = side * dpr
    el.height = side * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const css = getComputedStyle(el)
    const a = css.getPropertyValue('--pf-check-a').trim() || '#e9e9e6'
    const b = css.getPropertyValue('--pf-check-b').trim() || '#f4f4f2'
    const grid = css.getPropertyValue('--pf-grid').trim() || 'rgba(0,0,0,0.06)'
    const ring = css.getPropertyValue('--accent').trim() || '#2f7bd8'
    for (let y = 0; y < sprite.size; y++)
      for (let x = 0; x < sprite.size; x++) {
        const v = sprite.pixels[y * sprite.size + x]
        if (v >= 0) ctx.fillStyle = sprite.palette[v]
        else ctx.fillStyle = (x + y) % 2 ? a : b
        ctx.fillRect(x * cell, y * cell, cell, cell)
      }
    ctx.strokeStyle = grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let k = 1; k < sprite.size; k++) {
      ctx.moveTo(k * cell + 0.5, 0)
      ctx.lineTo(k * cell + 0.5, side)
      ctx.moveTo(0, k * cell + 0.5)
      ctx.lineTo(side, k * cell + 0.5)
    }
    ctx.stroke()
    if (tool.kind === 'eye' || sprite.eyes.length) {
      ctx.strokeStyle = ring
      ctx.lineWidth = 2
      for (const i of sprite.eyes) ctx.strokeRect((i % sprite.size) * cell + 1, Math.floor(i / sprite.size) * cell + 1, cell - 2, cell - 2)
    }
  }, [sprite, cell, side, tool.kind])

  const at = (e: ReactPointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.floor(((e.clientX - r.left) / r.width) * sprite.size)
    const y = Math.floor(((e.clientY - r.top) / r.height) * sprite.size)
    return x >= 0 && y >= 0 && x < sprite.size && y < sprite.size ? y * sprite.size + x : -1
  }
  return (
    <canvas
      ref={canvas}
      className={`pf-pixels tool-${tool.kind}`}
      style={{ width: side, height: side }}
      aria-label="Your pixel self, to touch up: click a pixel to paint it"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        onStroke()
        painting.current = tool.kind !== 'eye'
        const i = at(e)
        if (i >= 0) onPaint(i)
      }}
      onPointerMove={(e) => {
        if (!painting.current) return
        const i = at(e)
        if (i >= 0) onPaint(i)
      }}
      onPointerUp={() => (painting.current = false)}
      onPointerCancel={() => (painting.current = false)}
    />
  )
}

/** One of the three pictures to choose between */
function Choice({ value, current, label, profile, onPick, missing }: { value: PictureChoice; current: PictureChoice; label: string; profile: Profile; onPick(v: PictureChoice): void; missing?: string }) {
  const on = current === value
  return (
    <button type="button" role="radio" aria-checked={on} className={`pf-choice${on ? ' on' : ''}`} disabled={!!missing} onClick={() => onPick(value)}>
      {missing ? <span className="pf-choice-empty">{missing}</span> : <Avatar size={52} profile={{ ...profile, picture: value }} />}
      <span className="pf-choice-label">{label}</span>
    </button>
  )
}

export function ProfileSettings() {
  const app = useApp()
  const p = useProfile()
  const [source, setSource] = useState<HTMLImageElement | null>(null)
  const [crop, setCrop] = useState<Crop>(p.crop)
  const [camera, setCamera] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [sprite, setSprite] = useState<PixelSprite | null>(p.pixel)
  const [history, setHistory] = useState<PixelSprite[]>([])
  const [tool, setTool] = useState<Tool>({ kind: 'paint', colour: 0 })
  const [opts, setOpts] = useState<Options>(p.pixel ? { size: p.pixel.size, colours: p.pixel.colours, background: p.pixel.background } : DEFAULT_OPTIONS)
  const file = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // The photo as you chose it, kept by main, for framing again
  useEffect(() => {
    let gone = false
    window.tide.profile
      .source()
      .then((src) => (src ? loadImage(src) : null))
      .then((img) => !gone && setSource(img))
      .catch(() => {})
    return () => {
      gone = true
    }
  }, [])
  useEffect(() => setCrop(p.crop), [p.crop])
  useEffect(() => setSprite(p.pixel), [p.pixel])

  const adopt = useCallback(
    async (dataUrl: string) => {
      try {
        await window.tide.profile.setSource(dataUrl)
        const img = await loadImage(dataUrl)
        const fresh = { zoom: 1, x: 0, y: 0 }
        setSource(img)
        setCrop(fresh)
        setCamera(false)
        await updateProfile({ photo: framedPhoto(img, fresh), crop: fresh, ...(p.picture === 'initials' ? { picture: 'photo' as const } : {}) })
      } catch (e) {
        app.toast(errorText(e), { tone: 'error' })
      }
    },
    [app, p.picture]
  )

  const pickFile = async (f: File | undefined | null) => {
    if (!f) return
    try {
      await adopt(await fileToSource(f))
    } catch (e) {
      app.toast(errorText(e), { tone: 'error' })
    }
  }

  const cropNow = useRef(crop)
  cropNow.current = crop
  const saveFraming = () => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      if (source) void updateProfile({ photo: framedPhoto(source, cropNow.current), crop: cropNow.current })
    }, 250)
  }
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  // ---------- The pixel self ----------

  const spriteTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const keep = (next: PixelSprite | null, extra: Partial<Profile> = {}) => {
    setSprite(next)
    clearTimeout(spriteTimer.current)
    spriteTimer.current = setTimeout(() => void updateProfile({ pixel: next, ...extra }), next && sprite && next.size === sprite.size ? 300 : 0)
  }
  useEffect(() => () => clearTimeout(spriteTimer.current), [])

  const make = (o: Options) => {
    if (!source) return
    const next = pixelise(framedPixels(source, crop), o)
    if (sprite) setHistory((h) => [...h.slice(-40), sprite])
    setTool({ kind: 'paint', colour: Math.min(next.palette.length - 1, 1) })
    keep(next, !sprite && p.picture === 'initials' ? { picture: 'pixel' } : {})
  }
  const change = (patch: Partial<Options>) => {
    const o = { ...opts, ...patch }
    setOpts(o)
    if (sprite) make(o)
  }
  const stroke = () => sprite && setHistory((h) => [...h.slice(-40), sprite])
  const paint = (i: number) => {
    if (!sprite) return
    const next = tool.kind === 'eye' ? toggleEye(sprite, i) : paintPixel(sprite, i, tool.kind === 'erase' ? -1 : tool.colour)
    if (next !== sprite) keep(next)
  }
  const undo = () => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    keep(prev)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z' && history.length && !(e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]')) {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const first = greetingName(p)
  const hasPhoto = !!p.photo

  return (
    <>
      <div className="pf-hero">
        <Avatar size={64} animate />
        <div className="pf-hero-text">
          <div className="pf-hero-name">{p.name || 'Add your name'}</div>
          <div className="pf-hero-sub">{first ? `Home says “Good morning, ${first}”.` : 'Tide greets you by name once it has one.'}</div>
        </div>
      </div>

      <Group title="Your name">
        <Row label="Name">
          <TextField value={p.name} label="Your name" wide onSave={(name) => void updateProfile({ name })} />
        </Row>
        <Row label="Greetings call you" hint="Leave it empty to use the first word of your name.">
          <TextField value={p.short} label="What greetings call you" placeholder={p.name.trim().split(/\s+/)[0] || ''} onSave={(short) => void updateProfile({ short })} />
        </Row>
        <Row label="The tutor may use your first name" hint="Only your first name, now and then. Off keeps it out of every prompt, Gemma’s and Claude’s.">
          <Toggle label="The tutor may use your first name" on={p.tutorUsesName} onChange={(on) => void updateProfile({ tutorUsesName: on })} />
        </Row>
      </Group>

      <Group title="Your picture" note="Shown in the sidebar, beside your messages and threads, and at the workout’s parties.">
        <div className="set-pad">
          <div className="pf-choices" role="radiogroup" aria-label="Your picture">
            <Choice value="photo" current={p.picture} label="Photo" profile={p} onPick={(picture) => void updateProfile({ picture })} missing={hasPhoto ? undefined : 'No photo'} />
            <Choice value="pixel" current={p.picture} label="Pixel self" profile={p} onPick={(picture) => void updateProfile({ picture })} missing={p.pixel ? undefined : 'Not made'} />
            <Choice value="initials" current={p.picture} label={initials(p.name) ? 'Initials' : 'Plain'} profile={p} onPick={(picture) => void updateProfile({ picture })} />
          </div>
        </div>
      </Group>

      <Group title="Photo">
        <div
          className={`set-pad pf-photo${dragOver ? ' over' : ''}`}
          onDragOver={(e) => {
            if (![...e.dataTransfer.items].some((i) => i.kind === 'file')) return
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            void pickFile(e.dataTransfer.files[0])
          }}
        >
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void pickFile(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
          {camera ? (
            <Camera onTake={(d) => void adopt(d)} onCancel={() => setCamera(false)} />
          ) : source ? (
            <div className="pf-photo-row">
              <CropStage img={source} crop={crop} onCrop={setCrop} onDone={saveFraming} />
              <div className="pf-photo-side">
                <p className="set-hint">Drag to move it, and zoom to frame your face. It saves as you go.</p>
                <div className="pf-actions">
                  <button className="btn small" onClick={() => file.current?.click()}>
                    Choose another…
                  </button>
                  <button className="btn small" onClick={() => setCamera(true)}>
                    <Icon name="camera" size={14} />
                    Take one
                  </button>
                </div>
                <button
                  className="link-btn pf-remove"
                  onClick={async () => {
                    setSource(null)
                    adoptProfile(await window.tide.profile.clearPhoto(false))
                  }}
                >
                  Remove photo
                </button>
              </div>
            </div>
          ) : (
            <div className="pf-drop">
              <span className="pf-drop-circle" aria-hidden="true">
                <Icon name="image" size={22} />
              </span>
              <div className="pf-drop-text">
                <strong>Drop a photo here</strong>
                <span>PNG, JPEG or WebP. It stays on this Mac.</span>
              </div>
              <div className="pf-actions">
                <button className="btn small" onClick={() => file.current?.click()}>
                  Choose a photo…
                </button>
                <button className="btn small" onClick={() => setCamera(true)}>
                  <Icon name="camera" size={14} />
                  Take one
                </button>
              </div>
            </div>
          )}
        </div>
      </Group>

      <Group title="Pixel self" note="Made from your framed photo on this Mac: shrunk, reduced to a few colours and outlined, in the Professor’s style. No model, no network.">
        {!sprite ? (
          <div className="set-pad pf-pixel-empty">
            <p className="set-hint">{source ? 'Turn your framed photo into a small sprite. You can touch it up afterwards.' : 'Add a photo first; your pixel self is made from it.'}</p>
            <button className="btn small primary" disabled={!source} onClick={() => make(opts)}>
              Make my pixel self
            </button>
          </div>
        ) : (
          <>
            <div className="set-pad pf-editor">
              <PixelCanvas sprite={sprite} tool={tool} onStroke={stroke} onPaint={paint} />
              <div className="pf-tools">
                <div className="pf-tool-label">Colours</div>
                <div className="pf-palette" role="radiogroup" aria-label="Paint colour">
                  {sprite.palette.map((c, i) => (
                    <button key={i} type="button" role="radio" aria-checked={tool.kind === 'paint' && tool.colour === i} className={`pf-swatch${tool.kind === 'paint' && tool.colour === i ? ' on' : ''}`} style={{ ['--sw' as string]: c }} title={c} onClick={() => setTool({ kind: 'paint', colour: i })} />
                  ))}
                  <label className="pf-swatch pf-add" title="Add a colour">
                    <Icon name="plus" size={12} />
                    <input
                      type="color"
                      aria-label="Add a colour"
                      onChange={(e) => {
                        const { sprite: next, index } = withColour(sprite, e.target.value)
                        keep(next)
                        setTool({ kind: 'paint', colour: index })
                      }}
                    />
                  </label>
                </div>
                <div className="pf-toolrow">
                  <button type="button" className={`icon-btn pf-tool${tool.kind === 'erase' ? ' on' : ''}`} aria-pressed={tool.kind === 'erase'} title="Eraser" onClick={() => setTool({ kind: 'erase' })}>
                    <Icon name="eraser" size={15} />
                  </button>
                  <button type="button" className={`icon-btn pf-tool${tool.kind === 'eye' ? ' on' : ''}`} aria-pressed={tool.kind === 'eye'} title="Mark the eyes, for blinking" onClick={() => setTool({ kind: 'eye' })}>
                    <Icon name="eye" size={15} />
                  </button>
                  <span className="pf-sep" />
                  <button type="button" className="icon-btn pf-tool" disabled={!history.length} title="Undo (⌘Z)" onClick={undo}>
                    <Icon name="undo" size={15} />
                  </button>
                </div>
                <p className="set-hint pf-tool-hint">{tool.kind === 'eye' ? 'Click each eye’s pixels; they close for a blink. Click again to unmark.' : tool.kind === 'erase' ? 'Click or drag to clear pixels.' : 'Click or drag to paint.'}</p>
                <div className="pf-previews" aria-label="How it looks">
                  <Avatar size={22} profile={{ ...p, pixel: sprite, picture: 'pixel' }} />
                  <Avatar size={34} profile={{ ...p, pixel: sprite, picture: 'pixel' }} />
                  <PixelSelf sprite={sprite} size={sprite.size * 2} blink={p.blink} />
                </div>
              </div>
            </div>
            <Row label="Size" hint="Pixels across. Fewer is chunkier.">
              <PillSegment label="Size" value={String(opts.size)} onChange={(v) => change({ size: Number(v) })} options={SIZES.map((s) => ({ value: String(s), label: `${s}` }))} />
            </Row>
            <Row label="Colours" hint={`${opts.colours}, outline and backdrop included`}>
              <input className="set-range" type="range" min={MIN_COLOURS} max={MAX_COLOURS} step={1} value={opts.colours} aria-label="Colours" onChange={(e) => setOpts({ ...opts, colours: Number(e.target.value) })} onPointerUp={() => change({})} onKeyUp={() => change({})} />
            </Row>
            <Row label="Backdrop" hint="A flat colour from your photo behind you, or none.">
              <Toggle label="Backdrop" on={opts.background} onChange={(background) => change({ background })} />
            </Row>
            <Row label="Blink now and then" hint={sprite.eyes.length ? 'Still when your Mac asks for reduced motion.' : 'Mark the eyes with the eye tool first.'}>
              <Toggle label="Blink now and then" on={p.blink} onChange={(blink) => void updateProfile({ blink })} />
            </Row>
            <div className="set-pad pf-pixel-foot">
              <button className="btn small" disabled={!source} onClick={() => make(opts)} title="Your touch-ups are replaced; Undo brings them back">
                Make again from the photo
              </button>
              <button
                className="link-btn pf-remove"
                onClick={() => {
                  setHistory([])
                  keep(null)
                }}
              >
                Remove pixel self
              </button>
            </div>
          </>
        )}
      </Group>
    </>
  )
}
