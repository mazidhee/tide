import { useEffect, useState } from 'react'
import { providerInfo } from '@shared/providers'
import { CLAUDE_MODELS, claudeLabel, claudeModel } from '@shared/claude'
import type { ChatRequest, ClaudeModel, ClaudeStatusView } from '@shared/types'
import { useApp } from '../state'
import { PillSelect } from './PromptBox'

/** Who answers: auto (the "Who teaches" setting and the notebook), Gemma only, the cloud model, or Claude on a chosen model */
export type Engine = 'auto' | 'local' | 'cloud' | 'claude' | `claude:${ClaudeModel}`

const KEY = 'tide.chat.engine'

/** The model Chat uses, as last picked */
export function chatEngine(): Engine {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'local' || v === 'cloud' || v === 'claude' || v?.startsWith('claude:') ? (v as Engine) : 'auto'
  } catch {
    return 'auto'
  }
}

/** The request's fields for a choice: Claude on a model is Claude, with that model for this lesson */
export function engineFields(e: Engine): Pick<ChatRequest, 'engine' | 'claudeModel'> {
  if (e.startsWith('claude:')) return { engine: 'claude', claudeModel: e.slice(7) as ClaudeModel }
  return { engine: e as ChatRequest['engine'] }
}

let claudeSeen: Promise<ClaudeStatusView | null> | null = null
const claudeState = () => (claudeSeen ??= window.tide.claude.status().catch(() => null))

/**
 * Which model answers: Claude (on the model you pick for this lesson), Gemma on this Mac, the
 * cloud model, or Auto, which follows Settings and the notebook. Shown once Claude or a cloud
 * model is set up.
 */
export function EnginePill({ value, onChange }: { value?: Engine; onChange?(v: Engine): void }) {
  const app = useApp()
  const cloud = app.settings.cloud
  const [hasKey, setHasKey] = useState(false)
  const [claude, setClaude] = useState(false)
  const [own, setOwn] = useState<Engine>(chatEngine)
  useEffect(() => {
    if (cloud && cloud.mode !== 'off') window.tide.cloud.keys().then((k) => setHasKey(!!k[cloud.provider]))
  }, [cloud])
  useEffect(() => {
    void claudeState().then((s) => setClaude(!!s?.loggedIn))
  }, [])
  const cloudOn = !!cloud && cloud.mode !== 'off' && hasKey
  if (!cloudOn && !claude) return null
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
  const c = app.settings.ai.claude
  const teaching = claude && c?.teacher !== 'gemma'
  const name = cloudOn ? (providerInfo(cloud!.provider, cloud).models.find((m) => m.id === cloud!.model)?.label ?? cloud!.model) : ''
  const options: { value: Engine; label: string }[] = [
    { value: 'auto', label: teaching ? `Auto (Claude ${claudeLabel(claudeModel('teach', c))})` : cloud?.mode === 'auto' && cloudOn ? 'Auto' : 'Gemma' },
    ...(claude ? CLAUDE_MODELS.filter((m) => m.id !== 'haiku').map((m) => ({ value: `claude:${m.id}` as Engine, label: `Claude ${m.label}` })) : []),
    ...(teaching || (cloudOn && cloud?.mode === 'auto') ? [{ value: 'local' as Engine, label: 'Gemma only' }] : []),
    ...(cloudOn ? [{ value: 'cloud' as Engine, label: name }] : [])
  ]
  const shown = current === 'claude' ? (`claude:${claudeModel('teach', c)}` as Engine) : options.some((o) => o.value === current) ? current : 'auto'
  return <PillSelect label="Who teaches" icon="sparkle" value={shown} onChange={set} options={options} />
}
