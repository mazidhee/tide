import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { grabFrame, isPhoneCamera } from './paperPages'
import { pageKey } from '../../lib/typing'

/**
 * Your iPhone as the camera (macOS Continuity Camera): with the phone near the Mac, locked, and on
 * the same Apple Account, macOS offers it to apps as a camera. Tide picks it, shows what it sees,
 * and Space takes the photo; it lands in your answer with nothing saved on the phone. When the
 * phone isn't offered, the Mac's own camera can be picked instead, and the reason is said.
 *
 * (The "Import from iPhone → Take Photo" item macOS adds to native apps' menus can't be reached
 * from Electron: it needs an AppKit text view that accepts images through the Services system, and
 * Chromium's view only takes text. The phone as a camera is the reliable route.)
 */
export function PhoneCamera({ onTake, onCancel }: { onTake(dataUrl: string): void; onCancel(): void }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [device, setDevice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [taking, setTaking] = useState(false)
  const [live, setLive] = useState(false)

  // Find the cameras (names appear once the Mac has said Tide may use one)
  useEffect(() => {
    let gone = false
    const find = async () => {
      try {
        const first = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        first.getTracks().forEach((t) => t.stop())
      } catch {
        if (!gone) setError('Tide couldn’t use a camera. Allow it in System Settings › Privacy & Security › Camera.')
        return
      }
      const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
      if (gone) return
      setDevices(all)
      setDevice((d) => d ?? (all.find((x) => isPhoneCamera(x.label)) ?? all[0])?.deviceId ?? null)
    }
    void find()
    // The phone can appear a few seconds after it's picked up
    const onChange = () => void navigator.mediaDevices.enumerateDevices().then((all) => {
      const cams = all.filter((d) => d.kind === 'videoinput')
      setDevices(cams)
      const phone = cams.find((x) => isPhoneCamera(x.label))
      if (phone) setDevice((d) => (d && cams.find((c) => c.deviceId === d && isPhoneCamera(c.label)) ? d : phone.deviceId))
    })
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => {
      gone = true
      navigator.mediaDevices.removeEventListener('devicechange', onChange)
    }
  }, [])

  useEffect(() => {
    if (!device) return
    let gone = false
    setLive(false)
    navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: device }, width: { ideal: 4032 }, height: { ideal: 3024 } }, audio: false })
      .then((s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop())
        stream.current?.getTracks().forEach((t) => t.stop())
        stream.current = s
        if (video.current) video.current.srcObject = s
        setError(null)
      })
      .catch(() => !gone && setError('That camera didn’t start. If it’s your iPhone, lock it and keep it close to the Mac.'))
    return () => {
      gone = true
    }
  }, [device])

  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), [])

  const take = async () => {
    const v = video.current
    if (!v?.videoWidth || taking) return
    setTaking(true)
    try {
      onTake(await grabFrame(v, stream.current?.getVideoTracks()[0]))
    } finally {
      setTaking(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === ' ' && pageKey(e)) || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault()
        e.stopPropagation()
        void take()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const current = devices.find((d) => d.deviceId === device)
  const phone = !!current && isPhoneCamera(current.label)
  return (
    <div className="cam">
      <div className="cam-stage">
        <video ref={video} autoPlay playsInline muted onPlaying={() => setLive(true)} />
        {!live && !error && <span className="cam-wait">Opening the camera…</span>}
        {error && <span className="cam-wait error">{error}</span>}
        <span className="cam-frame" aria-hidden />
      </div>
      <div className="cam-bar">
        <select className="cam-pick" value={device ?? ''} onChange={(e) => setDevice(e.target.value)} aria-label="Camera">
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${i + 1}`}
            </option>
          ))}
        </select>
        <span className="cam-gap" />
        <button className="tool-btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" disabled={!live || taking} onClick={() => void take()}>
          <Icon name="camera" size={14} /> Take the photo <kbd>Space</kbd>
        </button>
      </div>
      {!phone && devices.length > 0 && (
        <p className="cam-help">
          Your iPhone isn’t showing as a camera yet. Lock it and hold it near the Mac (same Apple Account, Wi-Fi and Bluetooth on); it appears in the list above within a few seconds. Or take the photo on the phone and paste it here with <kbd>⌘V</kbd>.
        </p>
      )}
    </div>
  )
}
