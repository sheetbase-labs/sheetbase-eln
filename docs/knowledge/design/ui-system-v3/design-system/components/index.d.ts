/** Sheetbase React components. Global: window.Sheetbase. React 18. */
type Tone = 'progress' | 'review' | 'ok' | 'warn' | 'bad' | 'draft' | 'stored' | 'none' | 'analysis';
type IconName = 'home' | 'inbox' | 'calendar' | 'folder' | 'flask' | 'protocol' | 'tube' | 'box' | 'table' | 'chart' | 'schema' | 'settings' | 'plus' | 'check' | 'x' | 'chevronDown' | 'chevronRight' | 'arrowLeft' | 'bell' | 'search' | 'sun' | 'moon' | 'monitor' | 'more' | 'copy' | 'link' | 'download' | 'upload' | 'lock' | 'filter' | 'clock' | 'scan' | 'user' | 'signOut' | 'edit' | 'comment' | 'warn' | 'info' | 'pipeline' | 'play' | 'code' | 'webhook' | 'database' | 'pause' | 'template' | 'key' | 'plug' | 'move' | 'archive';
interface Common { className?: string; /** extra inline CSS, "a: b; c: d" or an object */ sx?: string | object; children?: any; [aria: `aria-${string}`]: any; }
/** Action. Renders <a> when href is set. */
export declare function Button(p: Common & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger' | 'danger-fill'; size?: 'sm' | 'md' | 'lg'; icon?: IconName; iconOnly?: boolean; href?: string; disabled?: boolean; onClick?: () => void; title?: string }): any;
/** Status dot plus label. */
export declare function Status(p: Common & { tone: Tone }): any;
export declare function Dot(p: Common & { tone: Tone }): any;
/** Removable filter token. */
export declare function Chip(p: Common & { onRemove?: () => void; removeLabel?: string }): any;
/** Diff marker. */
export declare function Tag(p: Common & { kind: 'add' | 'chg' | 'del' }): any;
export declare function Kbd(p: Common): any;
export declare function Avatar(p: Common & { initials: string; name?: string; tone?: 'accent' | 'review' | 'ok' | 'warn'; size?: 'sm' }): any;
export declare function Icon(p: { name: IconName; size?: number; className?: string; sx?: string | object }): any;
/** Page-wide state strip under the header. */
export declare function Banner(p: Common & { tone?: 'warn' | 'bad' | 'review' }): any;
/** Local message beside what it describes. */
export declare function Notice(p: Common & { tone?: 'info' | 'warn' | 'bad'; title?: string }): any;
export declare function EmptyState(p: Common & { title: string; body?: string; icon?: IconName }): any;
export declare function Skeleton(p: { w?: number | string; h?: number | string; r?: number; sx?: string | object }): any;
/** Linear flow progress. steps: list or "A|B|C"; current is 1-based. */
export declare function Stepper(p: Common & { steps: string[] | string; current: number; failed?: boolean }): any;
/** Confirmation after an action. */
export declare function Toast(p: Common & { tone?: 'bad'; action?: string; onAction?: () => void; onClose?: () => void }): any;
export declare function Tooltip(p: Common): any;
export declare function Menu(p: Common): any;
export declare function MenuItem(p: Common & { icon?: IconName; hint?: string; href?: string; onClick?: () => void; danger?: boolean; disabled?: boolean; highlighted?: boolean }): any;
export declare function MenuSep(): any;
export declare function MenuLabel(p: Common): any;
/** Radio group of options, e.g. the appearance switch. */
export declare function Segmented(p: Common & { options: string[] | string; icons?: string; value: string; onChange: (v: string) => void }): any;
/** Where a column or value comes from: a dataset snapshot, a linked record, a calculation, or local to one sheet. */
export declare function Source(p: Common & { kind: 'dataset' | 'record' | 'calc' | 'local'; title?: string }): any;
/** Before and after of one value. Omit before for an added value. */
export declare function Diff(p: Common & { before?: any; after?: any }): any;
/** A radio or checkbox option with a title and a line on its consequence. */
export declare function Choice(p: Common & { title: string; name?: string; checked?: boolean; disabled?: boolean; type?: 'radio' | 'checkbox'; onChange?: (e: any) => void }): any;
/** Folder tree. Children are TreeItem. */
export declare function Tree(p: Common): any;
export declare function TreeItem(p: Common & { depth?: number; current?: boolean; icon?: IconName; count?: string | number; href?: string; onClick?: () => void }): any;
/** A value shown once, such as a new API token, with a copy button. */
export declare function Secret(p: Common & { value: string; onCopy?: () => void; copyLabel?: string }): any;
/** The shared appearance setting. */
export declare const theme: { get(): 'system' | 'light' | 'dark'; set(v: 'system' | 'light' | 'dark'): void; resolved(override?: string): 'light' | 'dark'; subscribe(fn: () => void): () => void };
