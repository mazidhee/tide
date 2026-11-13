/** Files bundled into the main process as text (Vite's ?raw) */
declare module '*?raw' {
  const text: string
  export default text
}

/** Vite's import.meta.glob, as used for files bundled into the main process (main/visualLibs) */
interface ImportMeta {
  glob(pattern: string, options: { query: string; import: string; eager: true }): Record<string, unknown>
}
