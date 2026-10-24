// One icon set for the whole v2 UI: 24 × 24 grid, stroke only (width from --pos-icon-stroke), round caps and joins.
// Each icon is a list of path data; circles are written as two arcs so a single <path> renderer covers everything.
const circle=(cx:number,cy:number,r:number)=>`M${cx-r} ${cy}a${r} ${r} 0 1 0 ${2*r} 0a${r} ${r} 0 1 0 ${-2*r} 0`;
const dot=(cx:number,cy:number)=>`M${cx} ${cy}h.01`;

export const ICONS={
 // Navigation
 today:[circle(12,12,4),'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
 prospects:[circle(9,8,3.5),'M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6'],
 search:[circle(11,11,7),'M20 20l-3.5-3.5'],
 activity:['M3 12h4l3-8 4 16 3-8h4'],
 sources:['M4 5c0 1.7 3.6 3 8 3s8-1.3 8-3-3.6-3-8-3-8 1.3-8 3z','M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
 settings:['M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12',circle(16,6,2),circle(10,12,2),circle(18,18,2)],
 project:['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
 // Meaning
 signal:[circle(12,12,2),'M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2'],
 ai:['M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z','M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'],
 contact:['M22 2L11 13','M22 2l-7 20-4-9-9-4z'],
 verify:[circle(12,12,9),'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14',dot(12,17.5)],
 engage:['M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z'],
 watch:['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z',circle(12,12,3)],
 excluded:[circle(12,12,9),'M5.6 5.6l12.8 12.8'],
 verified:[circle(12,12,9),'M8.5 12.5l2.5 2.5 5-5.5'],
 declared:[circle(12,8,4),'M4 21a8 8 0 0 1 16 0'],
 info:[circle(12,12,9),'M12 11v5',dot(12,7.5)],
 warning:['M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z','M12 9v4',dot(12,17)],
 // Actions
 close:['M6 6l12 12M18 6L6 18'],
 check:['M5 12.5l4.5 4.5L19 7'],
 plus:['M12 5v14M5 12h14'],
 'chevron-right':['M9 6l6 6-6 6'],
 'chevron-left':['M15 6l-6 6 6 6'],
 'chevron-down':['M6 9l6 6 6-6'],
 'chevron-up-down':['M8 9l4-4 4 4M8 15l4 4 4-4'],
 'arrow-right':['M5 12h14M13 6l6 6-6 6'],
 external:['M14 4h6v6M20 4l-9 9','M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
 more:[dot(5,12),dot(12,12),dot(19,12)],
 menu:['M4 7h16M4 12h16M4 17h16'],
 filter:['M3 5h18l-7 8.5V19l-4 2v-7.5z'],
 // Theme
 sun:[circle(12,12,4),'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
 moon:['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'],
 system:['M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z','M8 20h8M12 16v4'],
} as const satisfies Record<string,readonly string[]>;

export type IconName=keyof typeof ICONS;
export const ICON_NAMES=Object.keys(ICONS) as IconName[];
