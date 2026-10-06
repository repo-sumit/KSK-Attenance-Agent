# Design system

The source of truth is `Doc/swiftchat-design-system.md` (SwiftChat DS) together with the approved `prototype/Prototype.html`. This document explains how the codebase applies them and lists every deliberate deviation. **Do not add new colours, fonts, radii or type sizes. Use the tokens.**

## Files

| File | Role |
|---|---|
| `src/styles/tokens.css` | DS primitives (primary blue, neutrals, secondary palette) → semantic tokens (background, text, icon, interactive, border, status, selection card), plus spacing, radius, dividers, touch sizes, layering and motion |
| `src/styles/typography.css` | DS text styles as `--type-*` (the `font` shorthand) and `--ls-*` (letter spacing). Marathi twins under `:root:lang(mr)` |
| `src/styles/globals.css` | Reset, focus ring, `.visually-hidden`, keyframes, reduced motion, print rules |
| `src/components/ui/*` | The kit: every screen is built from these |
| `src/components/shell/*` | `ScreenLayout` (frame, gutters, card mode), `TopBand` (the one fixed band above the scroller, D-159), `DockInset` (how high the Voice Agent widget sits, D-147), `AppNav` (bottom nav on phones, header nav from 600px), `ToolSlot` (the header's empty slot for tooling outside the product), `InlineBackBar`, connectivity banner, session gate |
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

- **Fonts:** Montserrat for English and Latin script, Mukta for Marathi/Devanagari, both loaded through `next/font` (`src/app/layout.tsx`). With `<html lang="mr">`, every `--type-*` switches to Mukta with taller line heights (so matras never clip) and zero letter spacing. Master data (student, staff and trade names, IDs) is wrapped in `<Latin>` (`lang="en"`), which restores the Latin style for that subtree. Translated words never are (D-159). Inside a translated sentence, master data goes through `LatinText` (`src/features/common/LatinText.tsx`: the named params are set as `<Latin>`, the words around them are not, in one inline span so a flex row keeps the sentence as one item; `slotted()` puts any element into a message the same way). `RoleLine` writes "Instructor · Electrician" with the role translated and only the trade in Latin, and `BatchLabel`/`SessionName` do the same for a batch or session. `tests/e2e/marathi-fonts.spec.ts` fails on a visible Latin word drawn in Mukta or Devanagari inside a `lang="en"` element.
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
| Not marked | circle (a dashed ring of 8 even dashes) | warning | "Choose" placeholder; warning border when the user tries to submit | warning-subtle while any remain (the ring at stroke 2) | 0 |

Roster rows are never tinted by status (D-070): the status control carries the colour. Only a row that still needs a choice after Review gets the warning edge, and its follow-up label becomes the instruction. The person Voice Agent asks about gets a focus-colour outline inside the row, no fill: a student on the roster (`focus_student`) and a staff member on the Staff screen (`focus_staff`, D-156).

Not marked is always the dashed ring, never the alert triangle: in the summary tile, the staff report's "N not marked today" fact and each person's "N days not marked" line (D-159).

The registry is in `src/domain/status.ts` (`STATUS_REGISTRY`) and the styling in `src/components/ui/status-style.ts`.

## Kit

| Component | Notes |
|---|---|
| `Button` | Variants: primary, secondary (outline), ghost, destructive, inverse. Sizes: lg 56, md 44, sm 36 (sm is for inline use only). `inactive` + `onInactivePress` keeps the button focusable and explains why it can't be used yet. `loading` shows a spinner and the busy label, keeps focus (`aria-disabled` + `aria-busy`, not `disabled`) and ignores taps |
| `IconButton` | 44px circle; always carries a `label` |
| `Input` | 52px pill with a linked `<label>`; the error has `role="alert"` and is tied to the field with `aria-describedby` |
| `Segmented` | `radiogroup` with arrow-key support; the small size keeps its look but its tap area reaches 44px. **One rule (D-159):** a screen's view switch (the principal's Students / Staff, Home's trade switcher) is `md` with `fullWidth` and spans the content column; a filter (a report's range) is `sm` with `fullWidth` and spans the column; a control inside a panel or row (the leaderboard sort, the language in the profile menu) is `sm` at its natural width from 600px. There is no `capped` width |
| `AttendanceStatusSelect`, `LockedStatus` | One status control per person on every marking roster (students, staff; D-062). A native `<select>` drawn as a 44px status pill: icon, label, chevron and tone, 9.5em wide so each row's control lines up in one column. Its name is "Attendance for {name}", its options come only from configuration, "Choose" is the blank placeholder, and `quiet` marks the starting status. `LockedStatus` is the same pill filled with the tone and a lock (OJT from the ERP, a saved staff mark), not a control |
| `StatusChip`, `Badge` | Read-only status or labels |
| `StatusLine` | A short state beside or under a row title: icon + coloured text (success, warning, error, info, neutral), label-small-strong, 16px icon, 4px gap. Ready offline, Refresh needed, N waiting to sync, N students at risk, Registered (D-068), "Marked today" (success, `circle-check`), "Mark your attendance first" (warning, in place of a batch row's Mark attendance while own attendance comes first, D-152), "Verified a moment ago" (success, a reused self check, D-152), and the warning "Not saved: someone else submitted this batch first." (alert icon) for a record the server refused (D-143) |
| `ChoicePill`, `SelectionCard` | Follow-up choices (half, leave type) and correction choices |
| `AttendanceSummary` | The running totals of a roster, review, record and staff day (D-069): the group total, one tile per configured status (registry order), Not marked when asked. Present is effective (presence weights: half day ½, OJT 1) and a line under the tiles shows the sum. Phones: rows of at most three, balanced, single-line tiles when there are more than three; from 560px one row of tiles at most `--summary-tile-max`; from 600px beside its `lead` when four or fewer. **Every summary in a fixed band has a lead** (D-159): the roster's date and closing time, the record's status strip, the staff day's date. `SummaryMeta` draws the lead's quiet line (an icon, then parts that never wrap, each "·" after its part) and `SummaryDate` its date: the long date ("Monday, 28 September") while the lead column is 340px or wider, the short one ("Mon, 28 Sep") below that (the lead is its own container, so a desktop roster lead of about 350px keeps the long date and phones and tablets get the short one). The expanded staff report row uses it too (Days, Present, Absent, Not marked). `summaryItems()` gives the same numbers to sheets and one-line summaries (`summaryLine()` in `features/common/labels.ts`). Surfaces: `hero` (tinted tiles on white), `raised` (on grey) |
| `InlineNote` | A quiet line of guidance: 16px icon + body-small secondary text, no fill or border (the roster hint, a record's correction rule) |
| `Card`, `PressableCard`, `ListRow`/`List`, `DetailRows`, `Section` | Content structure. `Card divided` is the list card: rows edge to edge with one divider between them (report batches, at-risk groups, offline batches with their action group, Review's exception groups). `Section level={3}` for a group inside a page section (a trade under "Your batches"). `Section action` puts one control on the title line, wrapping under a long title (the trade's "Trade register", the staff section's "Staff register", D-137, D-154); the action keeps the head's rhythm (its 44px target adds no height, so the title-to-subtitle gap is the same with or without one, D-159); an optional `ref` lets voice scroll a section into view. A page section takes a `title`-level heading ("Downloaded batches" on Offline data), and a group inside a Home section is an h3 |
| `Disclosure` | An expandable row: the whole row is a button (`aria-expanded`) with a turning chevron; the panel mounts only while open, so it can load its own data (report batches → leaderboard, at-risk groups). The optional `action` slot puts one control beside the toggle in the same header row (the batch row's register download icon, D-137): the toggle keeps the row's padding, hover and focus and takes the free width; the action sits at the row's end, never inside the toggle (no nested buttons), and a click on it never toggles the row. Without `action` the markup is unchanged |
| `Banner` | `bar` (sync/offline strip, no tracking so it fits on one line), `card` (stale roster, audit notes; quiet, not `strong`: "All attendance synced" with the end-of-day rule inside, "No students at risk", D-075) and `strip` (the compact record status line); optional action button |
| `SyncPendingCard` (feature) | Home and Offline data, only while records wait (D-064): soft warning surface, a white icon disc, title · count · why ("Auto-sync failed at 10:42 AM"), and one primary **Sync now** (md); on Home, for both roles while offline is on, a ghost "See what’s waiting" under it opens Offline data (D-153). Full width under the text on phones, beside it from 520px of card. States: waiting, syncing, couldn't sync (Try again), all synced |
| `BottomSheet` | A native `<dialog>` (focus trap and Esc for free). It opens with focus on its title, never on an action, because confirmation sheets confirm something irreversible. `closeLabel` makes a reading sheet (the announcements list): the title row with a ✕ stays pinned while the list scrolls, and there is no grabber (no swipe). Anchored to the bottom edge at every size (DS), 560px wide and centred from 600px (6/8, 6/12 columns); from 600px its actions sit side by side, 280px each (D-072). It owns the one overlay surface: `sheetSurface('bottom' \| 'anchored' \| 'drawer')`, `SheetGrabber` and `SheetTitleBar` (title-large, 44px close, one divider), 16px inner padding at every width; the profile menu and the demo panel compose it (D-076) |
| `Toast` | Polite live region above the dock and above the Voice Agent widget (D-147) |
| `RegisterDownloadButton`, `RegisterDownloadSheet` (feature, D-137) | The register download, shown only with `journey.reports.pdfDownload`. Three appearances of one button: a 44×44 brand download icon at the end of every batch row (accessible name and tooltip "Download register for Electrician · Shift 1 · Unit 2", in the `Disclosure` action slot), a secondary md "Download register" at the end of an expanded batch beside Hide students (they stack at 320px), and a ghost md "Trade register" on each trade's label line (name "Trade register: {trade}"). Each opens the same `BottomSheet`: title "Download attendance register", the batch or trade as its description, a native radio group "Month" (this month ("{month} · {range} so far"), last month) drawn in the selection-card anatomy with brand selected colours (a month is not a status), an `InlineNote`, then Download and Cancel. While it builds, Download shows "Preparing…" (`loading`) and Cancel, the radios, Esc and the scrim are disabled. Focus returns to the opener. One sheet at a time: a newer request (tap or voice) replaces an open one |
| `VoiceFloat`, `VoiceCard` (feature, D-133, D-147, D-148) | Voice Agent's one floating element, for instructors and the principal: a 56px round mic button (the extended "Voice Agent" pill from 1136px, where the corner sits in the page's wide margin; inactive offline), the voice card it grows into and a round status button when minimized or resting (white, ring and icon in the status colour). **One viewport overlay (D-147):** portaled to `<body>`, `position: fixed`, it never changes a screen's layout. Button, mini button and card share the bottom-right corner: `--float-inset` from the edges (16px, 24px from 600px), lifted by `--float-dock` (the screen's pinned footer band and bottom navigation, measured by `DockInset`; a dock that follows the content lifts it only when the widget would meet the footer's action) and by the floating demo pill; with the demo drawer open from 600px it moves left by `--overlay-width-drawer`. So it sits at the same place on every screen and never covers a footer CTA or the bottom navigation. Screens keep scroll room while it shows (`html[data-voice-float]` sets `--voice-reserve-block-end`, its measured height + 32px), so every row can scroll clear of it; `main` is the same height with the button and the card. Inline-footer screens from 600px keep a fixed room for the resting card under their dock instead (`--voice-reserve-resting`), and card screens keep none. At rest it can cover part of a row, which then scrolls clear. Toasts sit above it. **The card rests small:** phones, one compact row of at most 88px (the status toggle, the primary action, which is its icon alone below 480px with its name kept, Stop voice as an icon, Minimize); from 600px a two-line card `--overlay-width-voice` (360px) wide and about 128px high (status, level bar and Minimize in the head; the caption; the labelled actions Reconnect, Pause or Resume voice, Stop voice). The second caption, the hints, push-to-talk and the minutes-left note open from the status at any height. An error shows Reconnect and Stop voice, never Minimize. **Idle rest (Ruling R7):** while listening, after 6 s with no agent audio, no new caption and no pointer or focus in the card, the card yields to the mini status button; it opens again when the agent starts a new spoken turn, when the status needs the trainer (paused, reconnecting, an error) or the minutes-left warning changes. It never rests with push-to-talk on. A manual Minimize stays until tapped. **Statuses** (icon + text + colour): Connecting… (refresh, info), Listening (mic, success), Speaking (audio-lines, info), Working… (clock, info: a tool call has run 400 ms with no agent audio, D-156), Paused (pause, neutral), Reconnecting… (refresh, warning), Voice stopped (mic-off, error), Voice ended (mic-off, neutral), Hold to talk (mic-off, neutral, push-to-talk released) and Mic off for face check (mic-off, neutral, D-148: no level bar, no Pause, no Hold to talk; Stop voice stays). The pause action reads "Pause" (name "Pause voice"). Agent captions with no words (filler turns) are never shown. Under menus, sheets, toasts and the demo panel (`--z-voice`). An owner-requested deviation from the prototype (no floating controls there) |
| `BottomNav` | The journey's tabs: Home · Reports for instructors, Home · Attendance · Reports for the principal (D-052). Phones only; hidden from 600px, where the same destinations sit in the header. Profile is never a tab |
| `List grid` | `List` with `grid`: one grouped card on phones; from 640px of content, separate cards in two columns (the trade list) |
| `Skeleton` | `blocks` (plain cards), `rows` (row-shaped placeholders in one card, `leading` dot / tile / none to match the rows: roster, record, review, staff, reports, offline data) or `summary` (a headline figure, two facts and a short trend: My attendance, Institute attendance). Announces its label once (D-059) |
| `Avatar`, `IconWell`/`IconTile`, `ProgressBar`, `Spinner` | Supporting pieces. `IconWell settle` gives the result icon its small settle. `IconTile`, the rounded-square icon chip in cards and rows, has one size everywhere: 40px with a 20px icon (D-159) |
| `EmptyState`, `EmptyNote` | **Three empty-state patterns (D-159):** a screen whose only content is empty uses `EmptyState` (the 80px well, a title, an optional action); an empty section on a populated page is an `EmptyNote` (a quiet card with one body-medium secondary line: Home's "Nothing submitted yet", a batch with no attendance yet, a report range with no records); good news is a success `Banner` ("All attendance synced", "No students at risk") |
| `icons/` | 56 stroke icons (`paths.ts`), rendered by `Icon`: those extracted from the prototype plus a few from Lucide under its ISC licence (the demo trigger's `presentation`, D-157) |

`ScreenLayout` gives every screen the same frame: header → connectivity banner → optional fixed top region (roster summary) → **the only scroller** → dock (toast, footer CTA, bottom nav). Because only the main area scrolls, the summary and CTA can never cover a student row. This is the prototype's "sticky" behaviour without `position: sticky`. `footerDivider` adds a top divider to the footer (a full-width line on phones, inset to the card's content in card mode so the action keeps its 280px); the first login screen sets it while the Demo accounts list scrolls under it.

### Pieces added by the consistency pass (D-159)

| Component | Notes |
|---|---|
| `TopBand` (shell) | The one anatomy of a fixed band above the scroller: white, full bleed, one bottom divider, 12px above and below on the screen's column, 12px between items. The roster's summary, a record's strip and summary, and the principal's Students and Staff views use it, so the Students / Staff switch keeps its y, width and background when the principal flips views. On the Students view the switch sits in this white band, not at the top of the scroller as in the prototype |
| `CardPair` (Home) | Two cards side by side once the column is 640px wide (`@container (min-width: 640px)`, the one two-up trigger for every page pair), the grid gutter between columns, 12px between stacked cards; a lone card spans the row. Both Homes use it |
| `ProgressCard` (Home) | The one "x of y" card: tile, title, chevron; the count with its unit; the bar; an optional note. The principal's status cards and the instructor's trade overview |
| In-card action | One md action: full width under the text on phones, beside it from a 520px card (My attendance, `SyncPendingCard`). Two buttons side by side are 12px apart (8px when stacked on phones) |
| `LatinText`, `RoleLine`, `SessionName` (common) | Master data inside translated text (see Fonts). Both Home subtitles are "{date} · {role}" through `RoleLine` (the principal's reads "Tuesday, 6 October · Principal") |

### Shell components added for wider screens and the profile menu

| Component | Phones (< 600px) | 600px and up |
|---|---|---|
| `AppHeader` | One 60px bar. Tab roots: KSK emblem, "KSK Attendance", institute; task screens: back/close + screen title. Avatar top right, always the right-most control. Demo builds: the trigger sits immediately left of the avatar (icon-only on task screens and below 360px, D-066); the brand is `lang="en"` so it measures the same in Marathi (D-076) | 64px full-width bar aligned to the wide column: brand · the journey's tabs · [Demo] avatar. Task screens add a context row (back + title) aligned to the screen's column |
| `HeaderNav` | Hidden | Pills with icon + label (labels only below 768px); current page: brand-subtle fill, brand-subdued text, semibold; hover tint for mouse users only |
| `ProfileMenu` | Bottom sheet (DS sheet: radius xl top, grabber) | `--overlay-width-menu` (360px) menu anchored under the avatar at the header's bottom + 8px, right edges aligned, radius xl, rows edge to edge, no scrim (D-076) |
| Camera view | Portrait frame 288px (registration) / 248px (daily check), capped by screen height | Up to 480px (registration) / 320px (daily), never full-screen; instructions stay next to the frame |
| Demo accounts (demo, D-157) | Under the Institute code field, an always-visible list in the presenter-tooling style (dashed warning-tone frame, `lang="en"`): a divided list of 56px rows, one per demo person (persona title, "name · what it shows", chevron), the current one with a brand-subtle tint and a check. A tap fills and advances, and every confirmation still shows | Same |
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
- **Columns by screen:** form 480 (confirmations, correction, self attendance, verification); reading 800 (roster, review, record, staff, the principal's Attendance board, the Reports page and report view, offline data and download); wide 1008 (home, class and trade lists).
- **Card screens:** login steps, face intro, permission primers, result screens and stand-alone problem screens become a centred 480px card on the page grey (`--color-background-surface`, the one page grey, D-076), with the action right under the content. Problem screens inside a signed-in flow keep the app header and use `inlineFooter`, so their action also sits under the message.
- **Primary actions:** full width on phones (DS 4/4); 280px and centred from 600px (DS "standalone button", never stretched). Two actions, or a message and its action, sit side by side from 600px (`ScreenLayout footerLayout="row"`, `BottomSheet` actions), each still 280px (D-072).
- **Two columns at most**, with the DS column gutter (`--page-gutter`: 20 / 36 / 36px), only where both halves stay easy to read (the brief overrides the DS 4-up card grid): home's trade overview + *My attendance*, class cards, the trade list, the principal's status cards. Every page two-up starts at 640px of column (`@container (min-width: 640px)`), with 12px between stacked cards (`CardPair`, D-159). Reports stays one column, with each batch as a row.
- **The roster stays a row list** (name, father's name, one status select on the right) in the 800px column. The control keeps its 9.5em width at every size instead of stretching (8.5em in rows of 340px or less). The roster summary's date is short while its lead column is under 340px (phones, tablets) and long on a desktop (D-159). Follow-ups sit in the row under the name; the until date sits beside the leave types where it fits (D-070).
- **Class cards** on Home are one compact row: title and count left, action or state right, wrapping by content rather than a breakpoint; a batch with several marks today spans the row with its own two-up grid (D-071).
- **Demo controls** take no layout space (D-047). The trigger sits in the header's tool slot, immediately left of the avatar (D-066), and floats only on headerless screens, the only time reserves apply (D-036).
- **The Voice Agent widget** takes no layout space either (D-147): one fixed overlay at the viewport's bottom-right corner, the same place on every screen, above the pinned footer and bottom navigation, with scroll room so every row can scroll clear. The round mic shows below 1136px, the "Voice Agent" pill from 1136px.
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
- **The Voice Agent overlay (D-147)** refines the owner-requested floating voice controls (D-133); it supersedes D-136's tall two-line rule and the reserved band.
- **One confirmation per submit (D-149, owner).** The prototype's "Submit attendance?" sheet is removed: the Review screen is the confirmation, with the standing note "After you submit, this attendance can’t be edited." and a guard so a double tap saves once. The correction and staff sheets stay.
- **No Today / Yesterday switch on the record (D-150, owner).** The record shows the session it was opened for; past days are in Reports (the register).
- **The principal's Students / Staff switch sits in the white `TopBand` (D-159)**, not at the top of the scroller as in the prototype, so it keeps its place on both views.

## The register as a printed document (D-137)

The monthly attendance register is not a screen. It is a standalone HTML file the user downloads, opens in a browser and prints, so the screen rules do not bind it:

- **A table is allowed.** "The roster is always a row list, never a table" is about screens. A printed register is a table by nature: one row per student, one column per day of the month, then Present, Absent, Leave, % and a remark, with a "Present (by day)" footer row. On a phone-width screen the register scrolls sideways inside its own box with #, Roll and Student kept in view; the page itself never scrolls sideways.
- **Its own print palette, not the tokens.** It is opened outside the app, so its styles are an inline stylesheet (`registerStyles.ts`, exempt from the token lint): a navy and saffron government header with the emblem, the status letters in the status colours, at-risk rows tinted amber with "⚠ At risk", Sundays and days without class grey, days ahead hatched, today outlined. Status is still letter + colour, explained by a legend, and "at risk" is always written.
- **Print first.** A4 landscape with 10mm margins, the header row repeated on every page, rows never split, a page per batch in a trade file, day columns 22px on screen, 24px on phones and 20px in print so 31 days fit. A sticky toolbar with a 44px "Print / Save as PDF" button shows on screen only.
- **Language.** The document follows the app's language (Marathi in Marathi, with Latin digits); names stay in Latin script.
