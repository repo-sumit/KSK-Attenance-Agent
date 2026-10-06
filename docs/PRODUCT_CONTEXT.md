# Product context

## What this is

KSK Attendance is one attendance product for Industrial Training Institutes (ITIs). Each state gets its own deployment, and every difference between states is a **configuration value, not a code change** (PRD §1). This repository is the **Maharashtra** instance. It runs as a MiniApp inside the **SwiftChat** Android app, which shows it in a WebView.

The PRD's design principle drives the whole codebase: *every component ships built; configuration decides which components appear, in what order and under what constraints. A disabled feature is absent from the flow, not greyed out.* (PRD §1.2)

## Who uses it

| Role | What they do here | Can correct a submitted mark? |
|---|---|---|
| **Instructor** (regular, contractual or guest) | Marks attendance for the batches the state's mapping rules give them. Marks their own attendance, first where the state asks for it (D-152). Views their reports. | No |
| **Group instructor** | Same as an instructor, plus a read-only overview of their whole trade. | No |
| **Principal / admin** | Sees the whole institute. Marks staff attendance. Corrects today's student marks, with a reason; every correction is audited. Can mark a batch that is still unsubmitted while its window is open. Works offline too (D-153). Institute reports, including the staff attendance report card (D-154). | Yes: same day, with a reason, logged |

The primary user is the instructor who opens the app every shift. Plan for these conditions: a low-end Android phone, bright workshops, often one-handed use, 20–35 students per batch, intermittent connectivity, and varied digital literacy. **Target: mark a 30-student batch in well under a minute** (PRD §2.1).

Students do not use this product.

## Goals (PRD §2.1)

1. One codebase, many state instances.
2. Configuration over code.
3. Marking is fast: everyone starts as Present (the Maharashtra default) and the instructor taps only the absentees.
4. Data is trustworthy. Where the state asks for it, location (geo-fence) and face are checked before the list opens.
5. Corrections are possible but accountable: principal only, same day only, reason required, append-only log.

Non-goals: student views, payroll/HR/leave management, timetable authoring, OJT declaration (that is an ERP action whose result this app consumes), and **backdating of any kind for any role**.

## Maharashtra configuration in one paragraph

Mapping is **open**: any instructor can mark any trade and batch in their institute. Verification is **geo-fencing (500 m) plus face**. Marking happens **once a day per batch** and **everyone starts Present**; the status set is Present and Absent. **Time fencing** is on, with shift windows 07:00–14:00 and 14:00–20:00, and institutes may override the windows. **Staff attendance** is on (self-marking plus principal marking), and **own attendance comes first**: an instructor marks their own attendance before any student, and that self check also opens their next batch for 10 minutes, so it is one check, not two (D-152). All seven report blocks are enabled (Maharashtra switches off the PRD's daily register), students below 75% are flagged at risk, staff below 90% are flagged in the staff report, and the detail reports offer day, week, month and custom ranges. **Offline marking** of downloaded batches is on for every user, the principal included, with auto-sync. **Announcements** on Home are on. The UI is available in **English and Marathi**, with Latin digits in Marathi. The full list is in [CONFIGURATION.md](CONFIGURATION.md).

The demo can switch to the other models the PRD defines (trade-mapped, batch-mapped, timetable/period-wise, Employability Skills across trades, twice-daily, blank or absent defaults, half day, leave, OJT). Stakeholders can then see how another state would behave without a code change. See [DEMO_GUIDE.md](DEMO_GUIDE.md).

## Core journeys

1. **Login:** institute code → "Is this your institute?" → Trainer ID → "Is this you?" (name, designation, trade, employment type). On a first login with face verification on, the app first asks the user to set up their face (real camera, three photos; matching simulated).
2. **Mark students:** Home is today's work (D-052): anything waiting to sync (D-064), any notices, then today's classes, in the shape the configuration decides: the trade list (open), assigned batches (batch/ES), today's timetable (timetable), or a trade switcher (trade-mapped). Where own attendance comes first and it is not marked yet, Home puts *My attendance* at the top with "Mark my attendance", and every class says "Mark your attendance first" instead of offering to mark; no class opens, verifies or submits until it is done, by tap, voice or a typed link (D-152). The user verifies presence on a full-screen step (location, then face; skipped with "Verified a moment ago" when their own check passed in the last 10 minutes and covered the same checks). Then they mark each student with one status control (default Present; change it to Absent, or another status the state enables, D-062) and review the summary. **The Review screen is the one confirmation** (D-149): it shows the counts and names and says "After you submit, this attendance can’t be edited."; Submit saves at once (a double tap saves once), and the record locks. Voice asks its one spoken question instead.
3. **My attendance:** the instructor marks their own attendance with the same verification step, before their students where the state asks for it. Voice Agent asks for it first too (D-152).
4. **Principal:** an institute overview (batches submitted, staff marked, what needs attention), the Attendance board (batch records, Students / Staff), same-day corrections with a mandatory reason, staff marking and institute reports. A batch record shows only the session it was opened for: there is no Yesterday tab, because only today can be corrected (D-150); earlier days are in Reports.
5. **Offline:** for every user, the principal included (D-153). A user who can mark students downloads batches while online, marks them offline, and the records lock locally and sync automatically later; the principal downloads batches only while the state lets the principal mark students. Each downloaded batch shows when its student list was updated and can be refreshed on its own. Staff marks and corrections made offline wait on the phone and sync too ("Saved on this phone · will sync automatically"). Offline data lives under Reports and names every waiting record ("My attendance", "Staff attendance · {name}", "Correction · {student}"); for a user without downloads it is the sync status only ("Sync status"). Home's sync card links to it ("See what’s waiting"). The app always shows its sync state.
6. **Reports:** one page for this month, as rows and cards, never tables (D-053). Instructors see their own attendance with a short trend, their batches (tap one for its students, ranked) and the students at risk (below 75%). The principal sees the institute, every batch by trade, at-risk students and the **staff attendance report card** (D-154): this month's staff attendance with a short trend and "N staff not marked today", then every staff member, lowest % first, with today's status, "n of m days", the days not marked (shown apart, never counted as absent) and a % chip flagged below 90%, each opening to its day counts, plus a monthly staff register to download. Two detail reports (staff attendance and the correction log) have date ranges and print or save as PDF through the browser's print view.

## Integrity rules that no configuration can relax (PRD §5.3, §12, §18, §20)

- A marking session is submitted **once**, then locked for everyone.
- **No backdating or forward-dating.** Only today can be marked or corrected.
- Only the **principal** corrects, only **today's** records, and only with a **reason**. The original record is never overwritten; corrections are an append-only log.
- The **time fence** is hard, with no grace period. Once a window closes, an unsubmitted batch stays a visible gap.
- **Verification happens before the list** is shown, and submission checks it again.
- Staff get **one mark per person per day** across both paths. The first mark wins, and self-marking takes precedence in the principal's list.
- **OJT** comes only from ERP declarations. It is never chosen or corrected in this app.
- A record that is **not yet synced cannot be corrected**.

## Screens and devices

The primary device is a low-end Android phone in the SwiftChat WebView, so phones (320–412px) are the reference design. The same app also opens in a normal browser on a tablet, laptop or projector. There it uses the whole screen: the same simple screens with more breathing room, the navigation in the header, and content in a readable column. It gains no extra features, buttons or analytics (D-045).

Navigation is **Home · Reports** for instructors and **Home · Attendance · Reports** for the principal (D-052). Profile is not a destination. The person's initials at the top right of every screen open a small menu: identity, language, face registration, help and logout (D-046).

## What is simulated in this build

This build uses **fictional data and simulations only**, and no real credentials exist. The data lives either on the device (the mock) or, when the build is configured for it, in a **shared Supabase demo project** that every device sees live (D-143). That project has no real identity behind it and permissive demo security (D-144), so it must never hold real data; see `docs/SUPABASE.md`.

- **Login** looks up mock institutes and staff. There is no password or OTP (PRD open question 1: `login.second_factor` supports only `none`).
- **Face matching is simulated; the camera is real.** Face registration and the daily check open the phone's front camera and run a prototype movement check on the device (one face, in the oval, straight / turn left / turn right). Photos stay in memory for that screen and are never saved or sent. **No face is ever compared**: a demo switch decides "match" or "no match". Every face screen says so ("Prototype · photos are not saved · face matching is simulated"). **None of it may be presented as secure biometric verification or liveness detection** (D-048). On a machine without a camera the demo can simulate the camera too.
- **Location** is simulated by default in the demo (inside, outside, denied, or no GPS). The demo panel can switch to the device's real GPS, which is used only to compute distance from the mock institute. Code records which it was (`source: 'device' | 'simulated'`).
- **Server sync** is a simulated gateway that can be told to fail once on the mock; on the shared Supabase project the records really are pushed to it.
- **Voice Agent** talks to Google's Gemini Live model when a key is configured; demos without a microphone or key use a scripted stand-in (D-106).
- **Announcements** are six demo notices built relative to today. The PRD has no notices; they are an extension (D-054).
- **Network time** is simulated too: loading states show for a moment and say what they are waiting for (D-059).

What "production" still needs is in [ARCHITECTURE.md § Going live](ARCHITECTURE.md#going-live-what-replaces-the-mocks).

## Sources

- `Doc/PRD.pdf` is the product specification. Its section numbers are cited throughout the code as `PRD §n`.
- `prototype/Prototype.html` is the approved clickable prototype and is authoritative for layout, copy and flow.
- `Doc/swiftchat-design-system.md` is the SwiftChat Design System.
- `Doc/mh_ksk_logo.png` is the Maharashtra Kaushalya Samruddhi Kendra logo.
