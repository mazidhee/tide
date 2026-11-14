/** Sidebar items you can show or hide in Settings. Settings itself always stays, so it can't be lost. */
export const SIDEBAR_ITEMS = [
  { id: 'home', label: 'Home' },
  { id: 'learn', label: 'Learn' },
  { id: 'courses', label: 'Courses' },
  { id: 'projects', label: 'Projects' },
  { id: 'chat', label: 'Chat' },
  { id: 'practice', label: 'Practice' },
  { id: 'library', label: 'Library' },
  { id: 'review', label: 'Review' },
  { id: 'graph', label: 'Brain' },
  { id: 'notebooks', label: 'Notebooks list' },
  { id: 'focus', label: 'Focus timer' },
  { id: 'saveLink', label: 'Save a link' },
  { id: 'addFiles', label: 'Add files' },
  { id: 'help', label: 'Help' }
] as const

export type SidebarItem = (typeof SIDEBAR_ITEMS)[number]['id']
