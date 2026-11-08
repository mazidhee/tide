import { useEffect, useState } from 'react'
import { providerInfo } from '@shared/providers'
import { useApp } from '../state'
import { PillSelect } from './PromptBox'

export type Engine = 'auto' | 'local' | 'cloud'

const KEY = 'tide.chat.engine'

/** The model Chat uses, as last picked */
export function chatEngine(): Engine {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'local' || v === 'cloud' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * Which model answers: Gemma on this Mac, the cloud model, or (with automatic escalation on)
 * whichever fits the job. Only shown once a cloud model is set up with a key.
 */
export function EnginePill({ value, onChange }: { value?: Engine; onChange?(v: Engine): void }) {
  const app = useApp()
  const cloud = app.settings.cloud
  const [hasKey, setHasKey] = useState(false)
  const [own, setOwn] = useState<Engine>(chatEngine)
  useEffect(() => {
    if (cloud && cloud.mode !== 'off') window.tide.cloud.keys().then((k) => setHasKey(!!k[cloud.provider]))
  }, [cloud])
  if (!cloud || cloud.mode === 'off' || !hasKey) return null
  const current = value ?? own
  const set = (v: Engine) => {
    if (onChange) onChange(v)
    else {
      setOwn(v)
      try {
        localStorage.setItem(KEY, v)
      } catch {
        // just for this session then
      }
    }
  }
  const name = providerInfo(cloud.provider, cloud).models.find((m) => m.id === cloud.model)?.label ?? cloud.model
  const options =
    cloud.mode === 'auto'
      ? [
          { value: 'auto' as Engine, label: 'Auto' },
          { value: 'local' as Engine, label: 'Gemma only' },
          { value: 'cloud' as Engine, label: name }
        ]
      : [
          { value: 'auto' as Engine, label: 'Gemma' },
          { value: 'cloud' as Engine, label: name }
        ]
  return <PillSelect label="Which model answers" icon="sparkle" value={current === 'local' && cloud.mode !== 'auto' ? 'auto' : current} onChange={set} options={options} />
}
