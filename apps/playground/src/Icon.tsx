const paths = {
  diagram: 'M4 3h6v5H4z M14 16h6v5h-6z M14 3h6v5h-6z M7 8v10h7 M10 5.5h4',
  file: 'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6',
  new: 'M6 3h8l4 4v5 M6 3v18h6 M14 3v5h4 M17 14v7 M13.5 17.5h7',
  open: 'M3 8V5h6l2 3h10v3 M3 8v12h16l3-9H7l-4 9',
  save: 'M4 3h13l3 3v15H4z M8 3v6h8V3 M8 21v-8h8v8',
  undo: 'M9 5 4 10l5 5 M4 10h10a6 6 0 0 1 6 6v3',
  redo: 'm15 5 5 5-5 5 M20 10H10a6 6 0 0 0-6 6v3',
  select: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M9 9l8 4-4 1-1 4z',
  node: 'M10 4H4v16h16v-6 M17 2v9 M12.5 6.5h9',
  group: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M7 7h7v6H7z M10 13v4h7v-6h-3',
  link: 'm8 8 4-4 4 4 M12 4v10 M16 16l-4 4-4-4 M12 20v-6',
  code: 'm8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16',
  copy: 'M9 8h11v13H9z M15 8V3H4v13h5',
  check: 'm5 12 4 4L19 6',
  warning: 'M12 3 2 21h20z M12 9v5 M12 17v.5',
} as const

export type IconName = keyof typeof paths

export function Icon({ name }: { name: IconName }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[name]} />
  </svg>
}
