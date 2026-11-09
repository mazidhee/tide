import type { TideApi } from '../shared/types'

declare global {
  interface Window {
    tide: TideApi
    tideEvents: {
      onMenu(cb: (action: string) => void): () => void
      onLink(cb: (url: string) => void): () => void
      onModelBusy(cb: (busy: boolean) => void): () => void
      pendingLink(): Promise<string | null>
      pathForFile(file: File): string
    }
  }
}

export {}
