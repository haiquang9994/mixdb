import { Icon, type IconProps } from "./Icon";

/* Every icon in the app, drawn on {@link Icon}'s 24×24 grid. Keeping them in one file keeps the
 * set visible as a set: adding one means matching the weight and shape of the others rather
 * than pasting in whatever a search turned up. */

/** Delete: a document, a property, an item. */
export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
      <path d="M18.5 6l-.8 13.1A2 2 0 0 1 15.7 21H8.3a2 2 0 0 1-2-1.9L5.5 6" />
      <path d="M10 10.5v6" />
      <path d="M14 10.5v6" />
    </Icon>
  );
}

/** Write something out of the app and onto disk — dumping a database to a file. */
export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v11" />
      <path d="M7.5 9.5L12 14l4.5-4.5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Icon>
  );
}

/** Read something off disk and into the app — restoring a database from a file. */
export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 14V3" />
      <path d="M7.5 7.5L12 3l4.5 4.5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Icon>
  );
}

/** A field that cannot be edited — the primary key of a document. */
export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="10.5" width="16" height="10.5" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </Icon>
  );
}

/** Confirmation that something landed — the flash after a save. */
export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 6.5L9.5 17 4 11.5" />
    </Icon>
  );
}

/** Dismiss: a tab, a banner, a dialog. */
export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </Icon>
  );
}

/** Add: a new tab. */
export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

/** Remove one of a repeating set — the filter bar's "drop this row" button. {@link PlusIcon}'s
 * counterpart, and drawn as its horizontal stroke alone so the pair reads together. */
export function MinusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
    </Icon>
  );
}

/** Duplicate: the table's "clone the selected rows" action. Two sheets, the front one offset
 * over the back one — the same shape the OS file managers use for a copy. */
export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </Icon>
  );
}

/** Open something for editing — a column, an index. Drawn as a pencil laid across the grid, its
 * tip at the bottom left, with the ferrule as the short stroke that tells the two ends apart. */
export function PencilIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 19.5l.9-3.9L16 5a2 2 0 0 1 2.9 2.9L8.4 18.6l-3.9.9Z" />
      <path d="M14.6 6.4l3 3" />
    </Icon>
  );
}

/** Collapsed disclosure, and "next" in a pager. */
export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 5l7 7-7 7" />
    </Icon>
  );
}

/** "Previous" in a pager. */
export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 5l-7 7 7 7" />
    </Icon>
  );
}

/** Expanded disclosure, and "sorted descending" in a grid header. */
export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 9l7 7 7-7" />
    </Icon>
  );
}

/** "Sorted ascending" in a grid header — {@link ChevronDownIcon} the other way up. */
export function ChevronUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 15l7-7 7 7" />
    </Icon>
  );
}

/** Refetch a list from the server — the sidebar's reload action. Drawn as an almost-closed
 * circle so that spinning it (while the reload is in flight) reads as motion. */
export function ReloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20.25 12a8.25 8.25 0 1 1-2.4-5.835" />
      <path d="M20.25 3v4.8h-4.8" />
    </Icon>
  );
}

/** Reveal something deliberately hidden — the connection string with its credentials in it. */
export function EyeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.5 12s3.9-6.75 10.5-6.75S22.5 12 22.5 12s-3.9 6.75-10.5 6.75S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

/** {@link EyeIcon} struck through: the same thing, currently hidden. */
export function EyeOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.5 12s3.9-6.75 10.5-6.75S22.5 12 22.5 12s-3.9 6.75-10.5 6.75S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      <path d="M3.75 20.25 20.25 3.75" />
    </Icon>
  );
}

/** A grouping rather than a thing — a row in the Redis key tree that stands for a shared prefix
 * and not for a key. Drawn as the tabbed folder the file managers use, so it reads at a glance
 * as "there is more inside" next to the type badges the real keys carry. */
export function FolderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 6.5a2 2 0 0 1 2-2h4a2 2 0 0 1 1.5.7l1.3 1.5H19a2 2 0 0 1 2 2v9.3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Icon>
  );
}

/** A status marker rather than an action — currently the "unsaved changes" bullet. Filled, so
 * it reads as a dot at the small sizes it is used at instead of as a thin ring. */
export function DotIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
    </Icon>
  );
}
