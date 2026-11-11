/** Tide's mark: two wave strokes on the app icon's dark blue square */
export function TideMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#12305c" />
      <path d="M5 10.2q3.5-4.4 7 0t7 0" fill="none" stroke="#e3eeff" strokeWidth="2" strokeLinecap="round" />
      <path d="M5 15.6q3.5-4.4 7 0t7 0" fill="none" stroke="#e3eeff" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
