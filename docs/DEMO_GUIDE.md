# Demo guide

This build is a stakeholder demo. It uses fictional data, a frozen clock, simulated location and a **real camera** with a prototype face check (face _matching_ is simulated), all controlled from a floating **Demo** panel. No photo is saved or sent. The records live either on this device only or, when the build has a Supabase project, in a **shared live backend** that every device sees (D-143; panel → **Data**, script 15).

## Starting

```bash
npm install
npm run dev            # http://localhost:3000
# or the production build
npm run build && npm start
```

It works on a phone, a tablet and a laptop or projector. The app is mobile-first but uses the whole screen on wider devices: a full-width header with the navigation, and content in a readable column (D-045).

The demo controls are **collapsed by default on every screen size**: a small yellow **Demo** trigger in the app header, **immediately left of the avatar** on every signed-in screen (D-066). The avatar always stays the right-most control. The deployed build has it too (D-067).

- **Phones:** labelled on Home and Reports; icon-only on task screens and below 360px. On screens without the header (login, camera, results) it floats top right. It opens a bottom sheet (up to 90% of the screen, scrolling inside).
- **Tablets and laptops:** beside the avatar at the end of the header row (icon-only up to 900px; bottom right on screens without the header). It opens a drawer on the right, below the header, that floats over the app. The app stays visible and usable, so you can change a setting and watch the screen react. **Esc** or **×** closes it.

**Jump straight to a story:** `/?preset=open`, `batch`, `timetable`, `es`, `principal`, `first_time` or `offline`.

**The demo clock** is frozen at **10:15 IST today** (D-017). Shift 1 is open, Period 3 is "Now", and Shift 2 opens at 2:00 PM. Change it under _Time → Demo clock_ (7:30, 10:15, 11:30, 2:30 PM, Real).

**Every day is a fresh day.** The data is built relative to today and reseeds when the date changes (D-018). **Reset everything** (bottom of the panel) restores the full story on this device at any time. On the shared source the first device to open the app each day sets up today's story on the server, and the shared records are reset with **Reset shared demo data** (script 16).

## Quick presets

| Preset                   | Who                         | What it shows                                                                       |
| ------------------------ | --------------------------- | ----------------------------------------------------------------------------------- |
| **Open instructor**      | Rajesh Patil (TR-10432)     | Any trade, any batch; geo-fence + face; everyone starts Present                     |
| **Batch mapped**         | Sunita Jadhav (TR-10518)    | Only her 2 assigned batches; the Shift 2 batch "Opens at 2:00 PM"                   |
| **Timetable**            | Vikas Shinde (TR-10377)     | Today's periods, time-fenced; Period 1 closed, Period 2 submitted, Period 3 **Now** |
| **Employability Skills** | Meera Kulkarni (TR-11024)   | 5 batches in 4 trades; a separate ES record per batch                               |
| **Principal**            | Dr. Anil Deshmukh (PR-2741) | Institute overview, batch records, corrections, staff marking, reports              |
| **First-time user**      | Rajesh Patil                | Starts at login; face not set up; location and camera permissions asked first       |
| **Offline**              | Rajesh Patil                | No network; downloaded batches still open; records wait to sync                     |

Presets sign straight in and keep the presenter's camera choice and voice model (below). Every preset switches **Voice Agent** on, the Principal's included (D-139).

**After an update, a stored preset is applied again once.** The demo state stores a `presetsVersion`. When `PRESETS_VERSION` (`src/demo/presets.ts`) is bumped (any change to a preset's configuration, simulation or clock), a browser that stored one of those presets re-applies it on its next start: configuration, simulation and clock follow the preset, while the persona, the sign-in choice and the machine's speed, camera, liveness and voice model are kept. The story therefore resets once after an update, and a demo left open before the update shows the new behaviour (this is how a pre-voice preset gained **Voice Agent**). A state with no preset (the presenter's own panel changes) is left alone (D-108). Unlike choosing a preset, the refresh does not clear verification passes or reset face registration.

## Logging in during a demo

The login screens show a dashed yellow **Use demo account** box under the field (D-058). It expands to five accounts: **Open instructor**, **Batch-mapped**, **Timetable**, **Employability Skills** and **Principal**. Picking one does three things:

- it sets up that account's story, as its preset would (configuration, simulation, the 10:15 clock, face registration), without signing in;
- it fills **Institute code** (27410) and puts the cursor there, so **Continue** (or Enter) moves on;
- the Trainer ID step then arrives already filled, with _Demo account: … · Change_.

The audience still sees the whole sequence: institute code → _Is this your institute?_ → Trainer ID → _Is this you?_. Nothing is submitted for you. Typing a different value forgets the pick. On the **First-time user** preset, picking _Open instructor_ keeps the first-time story (face not registered, permissions not asked). Production builds don't have the box.

**Quick login** (in the panel, under the presets) lists every demo person, including the Trade-mapped and Group instructors. Choosing one signs out and opens the real login screens with that person highlighted under _Use demo account_. Nothing is filled until you pick. Trade-mapped and Group aren't among the five accounts: type their Trainer ID from the table below.

| Person                                | Institute code | Trainer ID |
| ------------------------------------- | -------------- | ---------- |
| Rajesh Patil · Open instructor        | 27410          | TR-10432   |
| Sanjay More · Trade-mapped            | 27410          | TR-10455   |
| Sunita Jadhav · Batch-mapped          | 27410          | TR-10518   |
| Vikas Shinde · Timetable              | 27410          | TR-10377   |
| Meera Kulkarni · Employability Skills | 27410          | TR-11024   |
| Yogesh Dalvi · Group instructor       | 27410          | TR-10390   |
| Dr. Anil Deshmukh · Principal         | 27410          | PR-2741    |

To skip the login screens altogether: **Advanced → Skip login screens → On**, then use Quick login.

## Panel controls (Advanced)

Everything below the presets and quick login is under **Advanced**, collapsed by default.

| Section            | Controls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login              | Skip login screens: Off / On                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Verification       | Location: Off / Geo tagging / Geo fencing. **Location source: Simulated / This device (GPS)**. While simulated, Where is the phone: Inside / Outside / Denied / No GPS. Face verification: On/Off. Face registered: Yes/No. **Camera: This device / Simulated.** With this device: **Face detection: On-device / Guided only**. With Simulated: Registration: Works / Dark / 2 faces / Fails. **Face match (simulated): Matches / No match.** Permissions: Allowed / Ask first (location, and the simulated camera; a real camera asks the browser) |
| Marking            | Frequency: Once / Twice / Periods. Default: Present / Absent / Blank. Half day (+ Ask which half), Leave, OJT (from ERP)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Time               | Time fencing On/Off. Demo clock                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Staff attendance   | Staff attendance, Self attendance, Principal marks staff                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Voice              | Voice Agent: Off / On (only `voice.enabled`; limits and marking style stay as configured). While on, **Voice model: Live (Gemini) / Scripted (no mic, no network)**, used from the next Voice Agent start. Presets keep the voice model. |
| Network & language | Network: Online / Offline / Pending sync (a record waiting after a failed automatic attempt, D-064). Next sync: Works / Fails. Language: English / मराठी                                                                                                                                                                                                                                                                                                                                                                                            |

Any configuration change starts a new session: verification passes are cleared and every screen re-renders from the new journey. **Disabled features disappear** from the flow; they are never greyed out.

**Data** sits below Advanced, above **Reset demo**: _Shared (Supabase)_ or _This device_ (a switch only when the build has a Supabase project; otherwise it just reads _This device_). On the shared source it adds **Reset shared demo data**. See scripts 15 and 16.

## Demo scripts

### 1. Mark a batch in under a minute (Open instructor)

1. Preset **Open instructor** → Home shows the notice strip, _Today's attendance_ with the trade list (_Choose a trade, then a batch_), and _My attendance · Not marked_. The navigation is just **Home · Reports**: today's work is on Home (D-052).
2. **Electrician** → **Shift 1 · Unit 2**.
3. Verification runs on a full screen: _Checking your location…_ → _Location verified_ → _Look at the camera_ (the **live front camera**, with _Hold still_ once a face is found) → _Identity verified_. The note under it says it's a prototype: photos aren't saved and matching is simulated.
4. The roster opens with everyone **Present**. Set two students to **Absent**; the tiles update (31 · 29 · 2) and their controls turn red (rows stay white, D-070).
5. **Review & Submit** → the absent list → **Submit attendance** → confirm in the sheet → _Attendance submitted_.
6. Back on Home, the batch is under _Submitted today_. Open it again: it is **locked** ("can only be corrected by the principal today").

### 2. Location and face problems

1. In the panel (Advanced): _Where is the phone_ → **Outside** → open any open batch → _You're outside your institute · You are 1.24 km away_ → **Check again**.
2. **Denied** → _Location access is off_; **No GPS** → _Location is turned off_.
3. _Face match (simulated)_ → **No match** → _We couldn't verify your face_ → Try again.
4. Block the camera in the browser (site settings) → _Camera access is blocked · Allow camera access for KSK Attendance in your browser or phone settings, then try again_ → allow it → **Try again**. With _Camera: Simulated_, the same screen appears when the demo refuses the camera.
5. _Location_ → **Off** and _Face verification_ → **Off**: the verification screen disappears entirely and batches open straight to the list.

### 3. The mapping models (Batch mapped, Timetable, Employability Skills)

1. **Batch mapped**: only two cards; tap _Shift 2 · Unit 2_ → _Attendance isn't open yet · opens at 2:00 PM_.
2. **Timetable**: periods in time order; _Not marked · closed at 8:00 AM_; Period 2 _Submitted 9:52 AM_; Period 3 **Now** → mark it ("Period 3 · Theory" on the roster).
3. **Employability Skills**: "Employability Skills · 5 batches in 4 trades", grouped by trade. Marking Electrician Shift 1 · Unit 1 here creates the ES record and doesn't touch Rajesh's daily record for the same batch.

### 4. Principal: overview, correction, staff

1. Preset **Principal** → "Good morning, Principal", _4 of 17 batches submitted_, _9 Shift 2 batches open at 2:00 PM_, _Needs attention_ (two names, then _and N more_). The Attendance tab's trade rows add up to the same 4 of 17, and each says what is next under its count (_2 not submitted_, _Opens at 2:00 PM_, D-077).
2. **Attendance → Electrician → Shift 1 · Unit 1** (submitted 9:48 AM by Rajesh Patil) → tap the pencil on **Rahul Kumar** (Absent).
3. Choose **Present**, pick the reason _Student arrived late_ (or type one; a reason is required) → **Save correction**. The row shows _Corrected by principal_, and **Reports → More reports → Correction log** shows the entry with old → new, reason, who and when. The original record is untouched.
4. **Yesterday** tab on the same batch: read-only ("Attendance from previous days can't be corrected").
5. **Attendance → Staff**: self-verified staff are locked; mark the rest Present/Absent → **Save n changes**. With unsaved marks, leaving (Students, or any navigation) asks _Discard n changes?_ first.

### 5. Offline marking and sync

1. Preset **Offline** → the banner reads _You're offline. Attendance will sync automatically._
2. Open a downloaded batch (Electrician Shift 1 · Unit 2) → mark → submit → _Saved on this phone_.
3. Open **Fitter · Shift 1 · Unit 2**: _Student list downloaded on … New admissions may be missing._
4. Open a batch that wasn't downloaded (Mechanic Diesel) → _This batch isn't downloaded_.
5. **Done** → Home shows **Sync pending** · _1 attendance record waiting_ · _It will sync when you're back online_ (D-064). Panel → Network **Online** → _Syncing attendance…_ → _All attendance synced_, and the card goes away. For the failure path, set _Next sync_ → **Fails** first: the card says _Couldn't sync_ and offers **Try again**.
6. **Home's Sync pending card on its own:** any preset → Panel → Network **Pending sync** → _Sync pending · 1 attendance record waiting · Auto-sync failed at 10:15 AM_ with **Sync now** → tap it → _Syncing…_ → _All attendance synced_.
7. **Reports → Offline data** (D-056, D-065, D-075). Sync comes first: while a record waits, the Sync pending card lists it; otherwise a quiet _All attendance synced_ with the end-of-day rule. Each downloaded batch is two lines: its status (_Ready offline_, _Refresh needed_ with a warning edge, or _n waiting to sync_) and when it was updated, with its own refresh. The list ends with its action group: **Refresh all data**, and _Download more batches_ while any batch is left to download. Refreshing needs a connection: offline it says _Connect to the internet to refresh_.

### 6. Configuration changes, live

1. Each student has **one status select** on the right (D-062). Tap it: the phone's own list opens with only the statuses the configuration enables (Present and Absent in Maharashtra).
2. _Default_ → **Blank**: every row says _Choose_; Review & Submit stays inactive, says how many students remain, and a tap takes you to the first one.
3. _Half day_ **On** + _Ask which half_ **On**, _Leave_ **On**: the same select now lists Present, Absent, Half day, Leave; the row stays the same size, and the summary gains a tile for each (D-069). Half day asks _First half / Second half_ inside the row; Leave shows _Sick / Casual / Medical_ and then _Until (optional)_, beside them on a laptop. Mark two half days: Present counts each as ½ ("Present 27 = 24 + 2 Half day × ½ + 2 OJT" with OJT on).
4. _OJT_ **On**: in Electrician Shift 1 · Unit 2, rolls 6 and 13 show a locked **OJT** value with a lock ("Declared in the ERP" under it). It can't be changed, and it counts as present.
5. _Frequency_ → **Twice**: two cards per batch (First half / Second half, D-073), each locked separately.
6. _Staff attendance_ **Off**: _My attendance_ (Home and Reports) and the staff report disappear.

### 7. Marathi

Tap the avatar (top right) → Language **मराठी** (or Advanced → Language in the panel). Every screen switches to Marathi in Mukta, with Latin digits (D-012). Names stay in Latin script. Switch back to English the same way.

### 8. First-time user

Preset **First-time user** → **Use demo account** → **Open instructor** (or type **27410**) → _Is this your institute?_ → **Yes** → the Trainer ID (**TR-10432**) is already filled → **Continue** → _Is this you?_ → **Yes** → _Set up face verification_ → _Start_ → _Camera required_ → _Allow camera_ (the browser asks) → the live camera takes **three photos**: _Look straight_ → _Turn slightly left_ → _Turn slightly right_, each appearing as a thumbnail → _Face registered successfully_ → Home. The first attendance run then asks for location permission first.

On-device face detection guides each step: _Face not visible_, _Move closer_, _Keep your face in the oval_, _Only you in the frame_, _More light needed_, _Face detected_, _Hold still_, _Turn your head left_, _Turn back a little_, _Now turn the other way_, _Good_. If detection can't start on a device, after two failed attempts, or when you choose _Face detection: Guided only_, each photo is taken on a 3-2-1 countdown instead.

### 9. The same app on a laptop or projector

1. Open any preset at full window width. The header spans the screen: the KSK brand, the navigation (**Home · Reports** for instructors, **Home · Attendance · Reports** for the principal), then the **Demo** trigger and the avatar top right. There is no side column and no phone frame.
2. Home's trade list and class cards use two columns. Reports stays one readable column.
3. Open a batch: the roster is the same row list (name, father's name, the status select) in a readable centred column, with **Review & Submit** centred below. It is never a table.
4. Login and single-question steps appear as a centred card.
5. Open the Demo drawer, switch _Network → Offline_, and watch the banner appear with the drawer still open.

### 10. Notices, fresh student lists and reports

1. Preset **Open instructor**. Under the greeting, one strip: **Holiday** · _Special holiday: institute closed_ · _4 more announcements_. Tap it: the full list opens in a sheet. It has the Electrician timing change, _Batch on OJT_ for Electrician Shift 1 · Unit 1, the practical exam, and the instructor meeting (_For you_). The Welding notice isn't there, because it is for another trade (D-054).
2. Preset **Batch mapped**. Home's batch cards are one compact row each, with no data refresh (D-071). **Reports → Offline data**: tap the refresh on Shift 1 · Unit 2: _Refreshing student data…_ → _Updated just now_. The other batch still says 7:45 AM (D-055).
3. **Reports** (this month, D-053):
   - _My attendance_: the %, present and absent days, and _Last 3 months_.
   - _My batches_: tap a batch to see its students ranked 1…n. Switch _Highest first_ / _Lowest first_; anyone under 75% is flagged _At risk_.
   - _At-risk students_: only the students below 75%, grouped by batch (no filter needed, D-063). Tap a batch to see who.
   - _Offline data_ is at the bottom.
4. Preset **Employability Skills** → Reports: Meera's figures come from her own ES sessions in each batch (D-061).
5. Preset **Principal** → Reports: _Institute attendance_ (the institute and staff figures side by side; 417 students, 17 batches), _Batch attendance_ for all 17 batches grouped by trade, and at-risk students across the institute. Under _More reports_ are Staff attendance and the Correction log, each with a date range and **Print / Save as PDF**.

Early in a month, _This month_ covers only a few days, so the percentages swing. That is the real figure, not a fault.

### 11. Voice Agent

Voice Agent lets the trainer choose the batch, pass verification, mark exceptions and submit by speaking, while the screen follows along (D-078–D-145). Since D-139 to D-141 it also answers reports questions, marks the trainer's own attendance, and serves the principal (scripts 12 and 13). It is the round mic button at the bottom-right of every signed-in screen (a **Voice Agent** pill from 600px, D-133): tap it and it grows into the voice card, showing _Listening_, with **Use screen** (pause), **Resume voice** and **Stop voice**; minimize it to a round status button while voice keeps running. On a phone of 360×700 or larger, and from 400px wide, the card has two lines (D-136). Taps keep working the whole time, and the model is told about each one.

**Live (Gemini), the real thing.** It needs:
- `GEMINI_API_KEY` set on the server, in a git-ignored env file: here `.env.development` (ignored by `.gitignore` line 58, even though an earlier line un-ignores it; `npm run voice:spike-token`, `voice:spike-voices` and `test:voice-live` load that file with `--env-file`), or the Vercel project settings. Never in a `NEXT_PUBLIC_` variable, never committed (see `.env.example`). Restart `npm run dev` after adding it. Without it voice says _Voice isn’t available right now_ and the screen keeps working.
- a microphone, a connection, and HTTPS or `localhost`. Earphones help in a noisy room.

Then: preset **Open instructor** → Advanced → _Voice model_ → **Live (Gemini)** (the default; the select shows only while voice is on) → the floating **Voice Agent** button (bottom-right) → allow the microphone. The agent greets you and names only the trades with a batch open now (Electrician, Fitter, Mechanic Diesel at 10:15); say the trade, then the batch (for example "Electrician, shift one unit two"). Verification runs on the screen as usual (the agent only says "please look at the screen"), and the agent then asks who is absent. Say the exceptions ("Aditi absent"; it asks "anyone else?"), then "that's all" or "submit". The agent reads the counts and asks; when it has finished asking, say yes (a yes said over the question is asked again, D-112). What to say about privacy: the voice is processed by Google to run Voice Agent, nothing is recorded, and captions stay in memory.

**Scripted (no mic, no network), for a room without either.** Advanced → _Voice model_ → **Scripted**. Voice Agent then talks to a stand-in model that says nothing on its own: you play the model from the browser console with `window.__kskDemo.voice`, exactly as the E2E tests do (`tests/e2e/voice.spec.ts`):

```js
const v = window.__kskDemo.voice;
await v.toolCall('select_trade', { trade: 'Electrician' });          // Home → the Electrician batches
await v.toolCall('select_batch', { batch: 'shift 1 unit 2' });        // verification, then the roster
await v.toolCall('set_student_status', { student: 'Aditi', status: 'ABSENT', heard: 'Aditi absent' });
const ask = await v.toolCall('submit_attendance');                    // opens the review, asks for a code
v.emit({ turnComplete: true });   // the model's asking turn ends
v.speak('yes');                   // the trainer answers: a code needs a new trainer turn after the question (D-112)
await v.toolCall('submit_attendance', { confirm_token: ask.confirm_token }); // one clear yes submits
v.texts();      // every [APP] message the app sent the model (taps, verification, the kickoff)
v.denyMic();    // the next start finds the microphone blocked: "Microphone is blocked…"
v.drop();       // the connection drops: "Voice disconnected… Tap Reconnect"
```

`speak(text)`, `emit(event)`, `responses()` and `goAway(ms)` are there too. A configuration change from the panel stops voice (a new session start); switching Voice Agent **Off** removes the button and the card.

### 12. Voice for an instructor: only what is open, then reports and own attendance

Use **Live (Gemini)** with a microphone, or **Scripted** and the console calls shown.

1. **Only open batches (D-134).** Preset **Employability Skills** (Meera, 10:15) → Voice Agent. The agent names only the three batches open now (Electrician Shift 1 · Unit 1, Fitter Shift 1 · Unit 2, COPA Shift 1 · Unit 1) and never the two that open at 2:00 PM. Ask for "Shift 2 Unit 3 Electrician": it says it opens at 2:00 PM.
2. **Auto-open (D-134).** Preset **Batch mapped** (Sunita) → Voice Agent. Only Shift 1 · Unit 2 can be marked, so the agent opens it at once: "Good morning, Sunita. Please look at the screen." The check runs; then "31 students, all present. Who is absent?". **Timetable** (Vikas) opens Period 3 the same way.
3. **Absentees and submit (D-135).** Say "sab present, sirf Aditi absent" (or "Aditi absent", then "that's all"). The agent asks in one line: "30 present, 1 absent: Aditi Joshi. Submit? It is final." When it has finished asking, say "haan" or "yes".
4. **Next batch (D-134, D-142).** Preset **Open instructor**: after both Electrician batches are submitted the agent offers "Shift 1, Unit 2, Fitter" next; "haan" opens it. When nothing else can be marked it says so and waits: voice stays on until you say "stop" or it goes idle (2 minutes).
5. **Reports questions (D-140).** Still on **Open instructor** (Rajesh), ask "How is Electrician Shift 1 Unit 1 doing?", "Who is at risk?" or "Which student has the lowest attendance?". The agent answers in one or two sentences with the app's own figures (it names the lowest three at-risk students), then asks whether to show it. Say yes: Reports opens with that batch expanded and scrolled into view, or the at-risk section. Scripted: `await v.toolCall('get_batch_report', { batch: 'electrician shift 1 unit 1' }); await v.toolCall('show_report');` Name the trade: after step 4 his reports also hold Fitter Shift 1 · Unit 2, so a bare shift and unit can match more than one batch, and the agent then asks which.
6. **Register by voice (D-140).** On **Open instructor**: "Download last month's register for Electrician Shift 2 Unit 1": Reports opens with the register sheet, that batch and last month already chosen. Tap **Download** (a browser download needs your tap). Scripted: `await v.toolCall('download_register', { target: 'shift 2 unit 1', month: 'LAST_MONTH' });`
7. **Own attendance (D-141).** "Meri attendance lagao" or "mark my attendance": My attendance opens and runs the same location and face check as a tap; when it passes, the agent saves the mark and says "Your attendance is marked present at 10:15 AM." Ask again: it says it is already marked. With _Where is the phone_ → **Outside**, the check fails, the agent says why, and nothing is marked (there is no override).

### 13. Voice for the principal: today's overview, staff marking, insights

Preset **Principal** → Voice Agent (the button is there for the principal too, D-139).

1. **Overview.** The agent greets "Anil" (no title) and says today's state in one line: "Four of seventeen batches submitted, five staff not marked yet. What do you need?".
2. **Screens and notices.** "Open staff attendance" opens Attendance → Staff. "Any notices today?" reads up to three notices with their dates and offers to open them; "haan, kholo" opens Home with the Announcements sheet.
3. **Staff mark after a yes (D-141).** "Who is not marked yet?" names up to five. "Mark Pradeep Gawde absent": the staff screen opens and the agent asks "Mark Pradeep Gawde absent for today? It is final." Nothing is saved yet. Say "haan": the row shows _Absent · Marked by principal_, locked, and the agent says how many are still not marked. Someone who marked themselves is never overwritten: the agent says their own mark stands. Scripted: `const ask = await v.toolCall('mark_staff', { staff: 'Pradeep Gawde', status: 'ABSENT' }); v.emit({ turnComplete: true }); v.speak('haan'); await v.toolCall('mark_staff', { staff: 'Pradeep Gawde', status: 'ABSENT', confirm_token: ask.confirm_token });`
4. **Insights (D-140).** "How is Electrician Shift 1 Unit 2 doing?", "How many students are at risk across the institute?" or "How is the institute this month compared with last month?" The answers are the app's figures; a yes shows the matching report. Corrections are not done by voice: they stay on the record screen with a reason.

### 14. Download the attendance register (D-137)

1. Preset **Batch mapped** (or **Open instructor**) → **Reports** → _My batches_. Each batch row ends with a download icon. Tap the one on **Electrician · Shift 1 · Unit 2** (its name says "Download register for Electrician · Shift 1 · Unit 2"): the sheet _Download attendance register_ opens with the batch as its subtitle; the row stays collapsed.
2. Choose the month: this month (_1–5 Oct so far_ style) or last month → **Download**. The file `KSK-register_electrician_S1-U2_<yyyy-mm>.html` downloads and the toast says _Register downloaded_. Open it in the browser: the state header with the emblem, the KPI strip, a day-by-day register (P, A, at-risk rows in amber, Sundays grey, `*` for a correction), the corrections, signature lines, and **Print / Save as PDF** for A4 landscape.
3. Expand a batch: **Download register** also sits at the end of its student list, beside _Hide students_.
4. **Trade register:** each trade's label line has **Trade register**: one file with a trade summary, then each batch on its own page.
5. Preset **Principal** → Reports → _Batch attendance_: the same buttons on all 17 batches and every trade.
6. Inside the SwiftChat WebView a download is not possible yet: the app says so and builds nothing. Advanced has no switch for this; demo it in a browser.

### 15. Two devices on the shared backend (Supabase)

Needs a build with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (for example `npm run dev` with them in `.env.development`; `docs/SUPABASE.md`). The panel's **Data** row then reads **Shared (Supabase)**.

1. **Laptop:** preset **Principal**. Home shows _N of 17 batches submitted_. The first device to open the app each day sets up today's story on the server (the first time about 1.2 MB, a couple of seconds; later days only the missing days).
2. **Phone** (or a second browser profile): preset **Batch mapped** (Sunita). Panel → Time → Demo clock **2:30 PM**, so Shift 2 · Unit 2 is open. Open it, mark one student absent, review and submit.
3. Watch the laptop: without a reload, Home shows one more batch submitted within about a second (Realtime). Reports updates too.
4. Records are saved on the phone first and then pushed, as in script 5: a batch marked offline (preset **Offline**, which brings its downloaded batches on the shared source too) reaches the laptop once the phone is back online.
5. If someone else already submitted that batch on another device, the phone's copy is not saved: the server's record wins and the phone shows _Not saved: someone else submitted this batch first._ where the server copy cannot be read.

The shared demo keeps today's records for every presenter until the next day or a shared reset: a batch submitted in an earlier run stays submitted.

### 16. The Data switch and Reset

1. Panel → **Data** → **This device**: the app reloads and asks you to sign in again; records now stay on this device only (no network use). **Shared (Supabase)** switches back the same way. A build without a Supabase project shows only _This device_. While this device holds records waiting to sync, the switch refuses and stays put, saying _N records on this device are waiting to sync. Sync them or reset the demo before switching data._ (for one: _1 record … is waiting to sync. Sync it or …_): tap **Sync now** online (or **Reset demo**), then switch. On _Shared (Supabase)_, presets, Reset and a fresh device bring the story's downloaded and stale batches, as on _This device_; a new day keeps only what the device holds.
2. **Reset demo** → **Reset everything** restores this device only (records, corrections, face enrolment, queue and settings) and keeps your Data choice.
3. **Reset shared demo data** (shared source only) asks first: _Delete the demo's attendance, corrections, staff marks and face registrations on the server for every device, then set up today's story again?_ → **Reset shared data** clears the server for **every** device, sets up today's story again and restarts this device.
4. **Reset uses two server functions** from `supabase/migrations/20261005041600_ksk_reset_functions.sql`, which the owner pasted once into the Supabase SQL editor (D-144; on `ksk-attendance` since 5 October 2026). On a project without them the panel says _Reset isn't set up on the server yet_ and the browser console shows one 404 line for that call; nothing else breaks. After a reset, another device that was open shows the reset batches as open again on its next online read.
5. On the shared source, the First-time preset and _Face registered: No_ remove that person's face registration on the server, so every device demonstrating that person sees it; the everyday presets and _Face registered: Yes_ give it back.

## Tips

- **If a screen seems stuck, it isn't.** Simulated delays run at normal speed (about 0.25–2 s), and each one says what it is waiting for ("Checking institute…", "Refreshing student data…", D-059). E2E tests run them at 5%.
- **The data looks wrong after a long demo:** use **Reset everything**.
- **No camera on this machine** (or it's in use): _Advanced → Camera → Simulated_. The face steps then play without a camera and say "Demo simulation · no camera or photo is used". Presets keep this choice.
- **Camera over the network:** browsers allow the camera only on HTTPS or `localhost`. Use the Vercel URL, or `localhost`, not a LAN IP over http.
- **No microphone, no network or no Gemini key:** _Advanced → Voice model → Scripted_ (script 11). Presets keep this choice.
- **The shared data looks used up** (a batch already submitted by an earlier presenter): **Reset shared demo data** (script 16), or switch the Data row to **This device** for a private story.
- **The shared project does not answer:** a free Supabase project pauses after a period without use; restore it from the Supabase dashboard (`docs/SUPABASE.md`), or switch to **This device**.
- **What to say about face checks:** the camera and the movement check are real and run on the phone; **matching is simulated**, nothing is saved or sent, and it is **not** secure biometric verification (a photo or video held up to the camera can pass). Production needs a certified matching and liveness provider (D-048).
