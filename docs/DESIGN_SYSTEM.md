# Design system

The source of truth is `Doc/swiftchat-design-system.md` (SwiftChat DS) together with the approved `prototype/Prototype.html`. This document explains how the codebase applies them and lists every deliberate deviation. **Do not add new colours, fonts, radii or type sizes. Use the tokens.**

## Files

| File | Role |
|---|---|
| `src/styles/tokens.css` | DS primitives (primary blue, neutrals, secondary palette) → semantic tokens (background, text, icon, interactive, border, status, selection card), plus spacing, radius, dividers, touch sizes, layering and motion |
| `src/styles/typography.css` | DS text styles as `--type-*` (the `font` shorthand) and `--ls-*` (letter spacing). Marathi twins under `:root:lang(mr)` |
| `src/styles/globals.css` | Reset, focus ring, `.visually-hidden`, keyframes, reduced motion, print rules |
| `src/components/ui/*` | The kit: every screen is built from these |
| `src/components/shell/*` | `ScreenLayout` (frame, gutters, card mode), `AppNav` (bottom nav on phones, header nav from 600px), `ToolSlot` (the header's empty slot for tooling outside the product), `InlineBackBar`, connectivity banner, session gate |
| `src/features/shell/AppHeader.tsx` | The one header of every signed-in screen (brand · navigation · avatar) |

Two **DS package extensions** cover the prototype's 12px/600 and 11px/600 text: `--type-label-small-strong` and `--type-caption-strong`, each with a Mukta twin. Other additions to the DS set are `--color-chat-input-background` (the DS chat input white, so fields stay white on the grey page), `--color-surface-pressed` (visible press feedback on white rows and cards) and `--color-interactive-destructive-fill` (the AA filled destructive red).

Apply a full DS text style like this:

```css
.title {
  font: var(--type-title-small);
  letter-spacing: var(--ls-title-small);
}
```

`tests/unit/design/token-lint.test.ts` fails the build on raw colours, radii or font sizes in any CSS Module. `tests/unit/design/contrast.test.ts` checks the WCAG ratio of every text/background pair the app uses.

## Foundations

- **Fonts:** Montserrat for English and Latin script, Mukta for Marathi/Devanagari, both loaded through `next/font` (`src/app/layout.tsx`). With `<html lang="mr">`, every `--type-*` switches to Mukta with taller line heights (so matras never clip) and zero letter spacing. Master data (student, staff and trade names, IDs) is wrapped in `<Latin>` (`lang="en"`), which restores the Latin style for that subtree.
- **Surfaces:** a grey app background (`--color-background-surface`, #ECECEC) with white raised cards (`--color-background-surface-raised`). Roster, record and staff lists run white and edge to edge, as in the prototype.
- **Spacing:** base-8 (`--space-8 … --space-96`). `--space-2` and `--space-4` are optical nudges only. The page margin is 16px.
- **Radius:** cards `--radius-lg` (12px), as the prototype chose; buttons, inputs, pills and chips `--radius-full`; tiles `--radius-md`.
- **Touch:** every interactive element is ≥ 44×44px (`--touch-target-min`). The primary CTA is 56px (`--cta-height`). Roster rows are at least 64px.
- **Light mode only** (`color-scheme: light`). SwiftChat's MiniApp surface is light.
- **Motion:** 80–200ms with no decorative animation (D-060). Each CSS module defines the keyframes it uses (CSS Modules scope animation names per file; a keyframe in `globals.css` would never match): `ksk-reveal` (a `Disclosure` panel grows open), `ksk-fade-in` (a status text that just changed, the toast), `ksk-pop` (the result icon settles), and `ksk-spin` (spinners, and the refresh icon while refreshing). `prefers-reduced-motion` collapses every animation and transition to its end state.

## Status language

Status is always **icon + text + colour**, never colour alone:

| Status | Icon | Tone | Status select (D-062) | Summary tile (D-069) | Counts toward Present |
|---|---|---|---|---|---|
| Present | check | success | green text and icon; grey border while it is the starting status, green otherwise | success-subtle | 1 |
| Absent | x | error | red text, icon and border | error-subtle | 0 |
| Half day | half | warning | amber text, icon and border | warning-subtle | ½ |
| Leave | calendar | info | blue text, icon and border | info-subtle | 0 |
| OJT | briefcase | brand | a locked value (brand fill, lock icon); never selectable | brand-subtle | 1 |
| Not marked | circle | warning | "Choose" placeholder; warning border when the user tries to submit | warning-subtle while any remain | 0 |

Roster rows are never tinted by status (D-070): the status control carries the colour. Only a row that still needs a choice after Review gets the warning edge, and its follow-up label becomes the instruction.

The registry is in `src/domain/status.ts` (`STATUS_REGISTRY`) and the styling in `src/components/ui/status-style.ts`.

## Kit

| Component | Notes |
|---|---|
| `Button` | Variants: primary, secondary (outline), ghost, destructive, inverse. Sizes: lg 56, md 44, sm 36 (sm is for inline use only). `inactive` + `onInactivePress` keeps the button focusable and explains why it can't be used yet. `loading` shows a spinner and the busy label, keeps focus (`aria-disabled` + `aria-busy`, not `disabled`) and ignores taps |
| `IconButton` | 44px circle; always carries a `label` |
| `Input` | 52px pill with a linked `<label>`; the error has `role="alert"` and is tied to the field with `aria-describedby` |
| `Segmented` | `radiogroup` with arrow-key support; the small size keeps its look but its tap area reaches 44px |
| `AttendanceStatusSelect`, `LockedStatus` | One status control per person on every marking roster (students, staff; D-062). A native `<select>` drawn as a 44px status pill: icon, label, chevron and tone, 9.5em wide so each row's control lines up in one column. Its name is "Attendance for {name}", its options come only from configuration, "Choose" is the blank placeholder, and `quiet` marks the starting status. `LockedStatus` is the same pill filled with the tone and a lock (OJT from the ERP, a saved staff mark), not a control |
| `StatusChip`, `Badge` | Read-only status or labels |
| `StatusLine` | A short state beside or under a row title: icon + coloured text (success, warning, error, info, neutral), label-small-strong, 16px icon, 4px gap. Ready offline, Refresh needed, N waiting to sync, N students at risk, Registered (D-068) |
| `ChoicePill`, `SelectionCard` | Follow-up choices (half, leave type) and correction choices |
| `AttendanceSummary` | The running totals of a roster, review, record and staff day (D-069): the group total, one tile per configured status (registry order), Not marked when asked. Present is effective (presence weights: half day ½, OJT 1) and a line under the tiles shows the sum. Phones: rows of at most three, balanced, single-line tiles when there are more than three; from 560px one row of tiles at most `--summary-tile-max`; from 600px beside its `lead` (date, batch) when four or fewer. `summaryItems()` gives the same numbers to sheets and one-line summaries (`summaryLine()` in `features/common/labels.ts`). Surfaces: `hero` (tinted tiles on white), `raised` (on grey) |
| `InlineNote` | A quiet line of guidance: 16px icon + body-small secondary text, no fill or border (the roster hint, a record's correction rule) |
| `Card`, `PressableCard`, `ListRow`/`List`, `DetailRows`, `Section` | Content structure. `Card divided` is the list card: rows edge to edge with one divider between them (report batches, at-risk groups, offline batches with their action group, Review's exception groups). `Section level={3}` for a group inside a page section (a trade under "Your batches") |
| `Disclosure` | An expandable row: the whole row is a button (`aria-expanded`) with a turning chevron; the panel mounts only while open, so it can load its own data (report batches → leaderboard, at-risk groups) |
| `Banner` | `bar` (sync/offline strip, no tracking so it fits on one line), `card` (stale roster, audit notes; quiet, not `strong`: "All attendance synced" with the end-of-day rule inside, "No students at risk", D-075) and `strip` (the compact record status line); optional action button |
| `SyncPendingCard` (feature) | Home and Offline data, only while records wait (D-064): soft warning surface, a white icon disc, title · count · why ("Auto-sync failed at 10:42 AM"), and one primary **Sync now** (md). Full width under the text on phones, beside it from 520px of card. States: waiting, syncing, couldn't sync (Try again), all synced |
| `BottomSheet` | A native `<dialog>` (focus trap and Esc for free). It opens with focus on its title, never on an action, because confirmation sheets confirm something irreversible. `closeLabel` makes a reading sheet (the announcements list): the title row with a ✕ stays pinned while the list scrolls, and there is no grabber (no swipe). Anchored to the bottom edge at every size (DS), 560px wide and centred from 600px (6/8, 6/12 columns); from 600px its actions sit side by side, 280px each (D-072). It owns the one overlay surface: `sheetSurface('bottom' \| 'anchored' \| 'drawer')`, `SheetGrabber` and `SheetTitleBar` (title-large, 44px close, one divider), 16px inner padding at every width; the profile menu and the demo panel compose it (D-076) |
| `Toast` | Polite live region above the dock |
| `VoiceFloat`, `VoiceCard` (feature, D-133) | Voice mode's one floating element: a 56px round mic button at the bottom-right (an extended "Voice mode" pill from 600px, inactive offline), the voice card it grows into (status icon + text + colour, caption, actions; one row and one line, at most 88px, on a compact phone) and a round status button when minimized (ring and icon in the status colour). Fixed on the screen's dock anchor above the footer and bottom navigation, with the DS margins; the card sits in a band the screen reserves, so it never covers a row or the Submit button, and the button leaves scroll room so the last row can scroll clear of it (as the demo pill does). Under menus, sheets and toasts (`--z-voice`). An owner-requested deviation from the prototype (no floating controls there) |
| `BottomNav` | The journey's tabs: Home · Reports for instructors, Home · Attendance · Reports for the principal (D-052). Phones only; hidden from 600px, where the same destinations sit in the header. Profile is never a tab |
| `List grid` | `List` with `grid`: one grouped card on phones; from 640px of content, separate cards in two columns (the trade list) |
| `Skeleton` | `blocks` (plain cards), `rows` (row-shaped placeholders in one card, `leading` dot / tile / none to match the rows: roster, record, review, staff, reports, offline data) or `summary` (a headline figure, two facts and a short trend: My attendance, Institute attendance). Announces its label once (D-059) |
| `Avatar`, `IconWell`/`IconTile`, `ProgressBar`, `EmptyState`, `Spinner` | Supporting pieces. `IconWell settle` gives the result icon its small settle |
| `icons/` | 48 stroke icons extracted from the prototype (`paths.ts`) and rendered by `Icon` |

`ScreenLayout` gives every screen the same frame: header → connectivity banner → optional fixed top region (roster summary) → **the only scroller** → dock (toast, footer CTA, bottom nav). Because only the main area scrolls, the summary and CTA can never cover a student row. This is the prototype's "sticky" behaviour without `position: sticky`.

### Shell components added for wider screens and the profile menu

| Component | Phones (< 600px) | 600px and up |
|---|---|---|
| `AppHeader` | One 60px bar. Tab roots: KSK emblem, "KSK Attendance", institute; task screens: back/close + screen title. Avatar top right, always the right-most control. Demo builds: the trigger sits immediately left of the avatar (icon-only on task screens and below 360px, D-066); the brand is `lang="en"` so it measures the same in Marathi (D-076) | 64px full-width bar aligned to the wide column: brand · the journey's tabs · [Demo] avatar. Task screens add a context row (back + title) aligned to the screen's column |
| `HeaderNav` | Hidden | Pills with icon + label (labels only below 768px); current page: brand-subtle fill, brand-subdued text, semibold; hover tint for mouse users only |
| `ProfileMenu` | Bottom sheet (DS sheet: radius xl top, grabber) | `--overlay-width-menu` (360px) menu anchored under the avatar at the header's bottom + 8px, right edges aligned, radius xl, rows edge to edge, no scrim (D-076) |
| Camera view | Portrait frame 288px (registration) / 248px (daily check), capped by screen height | Up to 480px (registration) / 320px (daily), never full-screen; instructions stay next to the frame |
| Use demo account (demo) | A dashed warning-tone box under the field, clearly presenter tooling rather than part of the form. The account list grows in place. Once an account is picked, it becomes one line: "Demo account: … · Change" | Same |
| Announcement strip | One card under the greeting: category badge (icon + word + colour: Important amber, Holiday green, OJT blue, Info grey), event date, title, "N more announcements"; the full list opens in a `BottomSheet` | Same, in the wide column |

## Responsive behaviour

**Mobile-first is not a fixed mobile viewport (D-045).** Phones (320–599px) are the primary design and are unchanged. From the DS medium breakpoint the app fills the viewport, and content keeps a readable column. Nothing new appears on bigger screens: the same hierarchy, with more breathing room.

| DS grid | Width | Columns | Page margin | Gutter |
|---|---|---|---|---|
| Small | 320–599 | 4 | 16 | 20 |
| Medium | 600–1135 | 8 | 36 | 36 |
| Large | 1136+ | 12 | 64 | 36 |

Tokens: `--grid-*-margin` and `--page-margin` (the current breakpoint's margin); content columns `--container-form` 480, `--container-reading` 800, `--container-wide` 1008 (12 columns at 1136 minus margins), `--container-footer` 280 (DS standalone button), `--container-dialog` 560, `--container-camera` 480.

- **Frame:** header, banner, top region and footer are full-bleed bars; their content aligns to the screen's column through `--gutter-*` (see ARCHITECTURE → Screen frame). Scrollbars stay visible for mouse users from 600px.
- **Columns by screen:** form 480 (confirmations, correction, self attendance, verification); reading 800 (roster, review, record, staff, the Reports page and report view, offline data and download); wide 1008 (home, class and trade lists, the principal's Attendance board).
- **Card screens:** login steps, face intro, permission primers, result screens and stand-alone problem screens become a centred 480px card on the page grey (`--color-background-surface`, the one page grey, D-076), with the action right under the content. Problem screens inside a signed-in flow keep the app header and use `inlineFooter`, so their action also sits under the message.
- **Primary actions:** full width on phones (DS 4/4); 280px and centred from 600px (DS "standalone button", never stretched). Two actions, or a message and its action, sit side by side from 600px (`ScreenLayout footerLayout="row"`, `BottomSheet` actions), each still 280px (D-072).
- **Two columns at most**, with the DS column gutter (`--page-gutter`: 20 / 36 / 36px), only where both halves stay easy to read (the brief overrides the DS 4-up card grid): home's trade overview + *My attendance*, class cards, the trade list, the principal's status cards. Reports stays one column, with each batch as a row.
- **The roster stays a row list** (name, father's name, one status select on the right) in the 800px column. The control keeps its 9.5em width at every size instead of stretching (8.5em in rows of 340px or less). Follow-ups sit in the row under the name; the until date sits beside the leave types where it fits (D-070).
- **Class cards** on Home are one compact row: title and count left, action or state right, wrapping by content rather than a breakpoint; a batch with several marks today spans the row with its own two-up grid (D-071).
- **Demo controls** take no layout space (D-047). The trigger sits in the header's tool slot, immediately left of the avatar (D-066), and floats only on headerless screens, the only time reserves apply (D-036).
- The target widths are 320, 360, 375, 390 and 412 for phones, and 768, 1024, 1280, 1440 and 1920 beyond. E2E checks that no width scrolls horizontally, that every row's status control lines up in one column at every phone width, and that wide screens aren't stuck at phone width or stretched (`desktop.spec.ts`).
- **Roster row:** roll · name and father's name · the status control. The name keeps at least 7em: with enlarged text the control drops under it, still right-aligned. Half day and leave ask their detail on a line underneath (which half, leave type, until date), whatever the status set.

## Deviations from the DS and prototype (all recorded in DECISIONS.md)

- **AA contrast overrides (D-010).** `text-secondary` #5A6684, `text-tertiary` #5F6673 and `text-warning` #8A5A00 replace the DS values, which fall below 4.5:1 on white, the grey page or warning-subtle. Selection-card text uses the success text colour. On the grey page, ghost buttons use brand-subdued; filled destructive buttons use #C0392B.
- **One status select per student instead of the prototype's Present/Absent pills (D-062, owner).** The prototype's pair (and its popover for extra statuses) became one native select per row, so rows stay compact however many statuses a state enables. It supersedes D-014, D-021 and D-038.
- **Every button label is 600 (D-037)**, as in the prototype.
- **Brand mark.** The prototype's placeholder check-mark tile is replaced by the real KSK emblem (D-003).
- **No fake phone frame or status bar.** The real device supplies them. Wider screens no longer show a phone column at all (D-045).
- **Top navigation instead of a DS side nav on wide screens (D-046).** The DS column table allows a 2/8 or 3/12 sidebar; the brief rules out a sidebar or rail for this deliberately simple product, so the primary destinations move into the header.
- **Two columns at most on wide screens (D-045).** The DS suggests 4-up card grids on desktop; the brief forbids dense grids for instructors.
