// Monaco's own language definitions for TypeScript and JavaScript (brackets, comments, pairs)
declare module 'monaco-editor/esm/vs/basic-languages/typescript/typescript.js' {
  export const conf: unknown
  export const language: unknown
}
declare module 'monaco-editor/esm/vs/basic-languages/javascript/javascript.js' {
  export const conf: unknown
  export const language: unknown
}
// Monaco's internal services, for the document symbol providers (lib/ide/symbols)
declare module 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js' {
  export const StandaloneServices: { get(id: unknown): unknown }
}
declare module 'monaco-editor/esm/vs/editor/common/services/languageFeatures.js' {
  export const ILanguageFeaturesService: unknown
}
