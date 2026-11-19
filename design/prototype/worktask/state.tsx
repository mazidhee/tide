/** The app state the harness's components ask for (useApp), without the app: toasts show as a strip */
export const useApp = () => ({
  toast: (text: string) => {
    const el = document.getElementById('toast')
    if (el) (el.textContent = text), (el.hidden = false)
  },
  setView: () => {},
  settings: { character: 'professor' }
})
export const useCharacter = () => 'professor'
