import { useEffect, useState } from 'react'
import type { PackStatus } from '@shared/notebook/api'
import { QUANT_PACK } from '@shared/labPack'
import { Icon } from '../Icon'

/** Progress and result of the quant pack's install, shared by the notebook's first-use card and Settings */
export function usePackInstall(onReady?: () => void) {
  const [status, setStatus] = useState<PackStatus | null>(null)
  const [step, setStep] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void window.tide.notebook.packStatus().then((s) => live && setStatus(s))
    const off = window.tide.notebook.onPackProgress((s) => setStep(s))
    return () => {
      live = false
      off()
    }
  }, [])
  const install = async () => {
    setBusy(true)
    setStep('Starting…')
    try {
      const s = await window.tide.notebook.installPack()
      setStatus(s)
      if (s.ready) onReady?.()
    } finally {
      setBusy(false)
      setStep('')
    }
  }
  return { status, step, busy, install, setStatus }
}

/** Shown in place of the kernel when the quant pack (with Jupyter's kernel) isn't installed yet */
export function PackCard({ onReady }: { onReady(): void }) {
  const { status, step, busy, install } = usePackInstall(onReady)
  return (
    <div className="nb-pack">
      <div className="nb-pack-icon">
        <Icon name="flask" size={20} />
      </div>
      <div className="nb-pack-body">
        <h3>Install the quant pack to run this notebook</h3>
        <p>
          Notebooks run on Jupyter’s own kernel. The quant pack adds it to Tide’s Python with {QUANT_PACK.contents.replace(/^the Jupyter kernel, /, '')}: {QUANT_PACK.download} to download, {QUANT_PACK.size} on disk. It installs in the background{status?.installer === 'uv' ? ' with uv' : ''}; you can keep reading the notebook meanwhile.
        </p>
        {busy ? (
          <div className="nb-pack-progress" role="status">
            <span className="nb-spinner" /> {step || 'Installing…'}
          </div>
        ) : (
          <div className="nb-pack-actions">
            <button className="btn primary" onClick={install}>
              Install ({QUANT_PACK.size})
            </button>
            {status && !status.ready && status.detail && !/^Not (installed|set up) yet/.test(status.detail) && <span className="nb-muted">{status.detail}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
