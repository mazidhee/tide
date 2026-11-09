import type { TideApi } from '../shared/types'

declare global {
  interface Window {
    tide: TideApi
    tideEvents: {
      onMenu(cb: (action: string) => void): () => void
      onLink(cb: (url: string) => void): () => void
      onModelBusy(cb: (busy: boolean) => void): () => void
      onVaultMoved(cb: (path: string) => void): () => void
      onVaultMissing(cb: (old: string) => void): () => void
      onBrainEvent(cb: (e: import('../shared/brain').BrainEvent) => void): () => void
      pendingLink(): Promise<string | null>
      pathForFile(file: File): string
    }
  }
}

export {}
