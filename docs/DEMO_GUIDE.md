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

The demo controls are **collapsed by default on every screen size**: a small yellow **Demo** trigger in the app header, **immediately left of the avatar** on every signed-in screen (D-066). The avatar always stays the right-most control. The deployed build has it too (D-067). The trigger carries a presenter icon, adds the signed-in person's first name from 600px (_Demo · Sunita_), and shows a wifi-off icon in place of the presenter icon while the demo is offline (D-157).

- **Phones:** labelled on Home and Reports; icon-only on task screens and below 360px. On screens without the header (login, camera, results) it floats top right, in a band of its own above the content, so rows never scroll under it. It opens a bottom sheet (up to 90% of the screen, scrolling inside).
- **Tablets and laptops:** beside the avatar at the end of the header row (icon-only up to 900px when the header carries the principal's three tabs; bottom right on screens without the header). It opens a drawer on the right, below the header, that floats over the app. The app stays visible and usable, so you can change a setting and watch the screen react. The Voice Agent button moves left of the open drawer. **Esc** or **×** closes it.

**Jump straight to a story:** `/?preset=open`, `trade`, `batch`, `timetable`, `es`, `group`, `principal`, `first_time` or `offline` (9 presets).

**The demo clock** is frozen at **10:15 IST today** (D-017). Shift 1 is open, Period 3 is "Now", and Shift 2 opens at 2:00 PM. Change it under _Quick settings → Time of day_ (7:30, 10:15, 11:30, 2:30 PM, Real). The clock moves only the classes: windows, cards and the rules. **The greetings follow the real time of day** (D-151): Home and Voice Agent say _Good morning_, _Good afternoon_, _Good evening_ or _Good night_ by the presenter's own clock (morning from 5:00, afternoon from 12:00, evening from 17:00, night from 21:00 IST), so an evening demo says "Good evening" while the batches still show 10:15.

**Every day is a fresh day.** The data is built relative to today and reseeds when the date changes (D-018). **Reset everything** (bottom of the panel) restores the full story on this device at any time. A fresh or reset demo is the **Open instructor** story with Voice Agent, the geo-fence and face on (D-157). On the shared source the first device to open the app each day sets up today's story on the server, and the shared records are reset with **Reset shared demo data** (script 16). When an update changes the story itself (round 2 moved today's four trade submissions to self-marked colleagues of the same trade, U2), a shared project already set up today keeps the old story until the next day: use **Reset shared demo data** once after deploying.

**Voice Agent missing in a browser you used before?** A browser that stored the earlier default demo state (before this round) keeps it, so it can claim the Open instructor story without its configuration: no Voice Agent button, no geo-fence or face. Tap **Reset demo** once (or any _Sign in as_ row) and it is back. A fresh browser needs nothing.

## Presets

| Preset                   | Who                         | What it shows                                                                       |
| ------------------------ | --------------------------- | ----------------------------------------------------------------------------------- |
| **Open instructor**      | Rajesh Patil (TR-10432)     | Any trade, any batch; geo-fence + face; everyone starts Present; **own attendance first** (not marked yet) |
| **Trade mapped**         | Sanjay More (TR-10455)      | Only Fitter + Welder; own attendance first (not marked yet)                         |
| **Batch mapped**         | Sunita Jadhav (TR-10518)    | Only her 2 assigned batches; the Shift 2 batch "Opens at 2:00 PM"                   |
| **Timetable**            | Vikas Shinde (TR-10377)     | Today's periods, time-fenced; Period 1 closed, Period 2 submitted, Period 3 **Now** |
| **Employability Skills** | Meera Kulkarni (TR-11024)   | 5 batches in 4 trades; a separate ES record per batch                               |
| **Group instructor**     | Yogesh Dalvi (TR-10390)     | 2 classes + the Electrician overview                                                |
| **Principal**            | Dr. Anil Deshmukh (PR-2741) | Institute overview, batch records, corrections, staff marking, staff report, reports |
| **First-time user**      | Rajesh Patil                | Starts at login; face not set up; location and camera permissions asked first       |
| **Offline**              | Rajesh Patil                | No network; downloaded batches still open; records wait to sync                     |

Presets sign straight in and keep the presenter's camera choice and voice model (below). Every preset switches **Voice Agent** on, the Principal's included (D-139). In the panel the seven people are the rows of **Sign in as** (each opens that person's everyday preset), and First-time user and Offline are the **Stories**.

**Own attendance first** is on in Maharashtra (D-152): an instructor marks their own attendance before any class opens. In today's story Sunita, Vikas, Meera and Yogesh marked themselves this morning, so their classes open at once; Rajesh and Sanjay have not, so their Home starts with _My attendance_ (script 1). The principal has no self-attendance step and is never held back; the principal's own staff row is marked like anyone else's (script 13). Every submission already in today's story was made by a trainer who had marked themselves first (Electrician Shift 1 · Unit 1, for example, by Kalpana Borse rather than Rajesh; on the shared source this story arrives with the next day's seed or a shared reset).

**After an update, a stored preset is applied again once.** The demo state stores a `presetsVersion`. When `PRESETS_VERSION` (`src/demo/presets.ts`) is bumped (any change to a preset's configuration, simulation or clock), a browser that stored one of those presets re-applies it on its next start: configuration, simulation and clock follow the preset, while the persona, the sign-in choice and the machine's speed, camera, liveness and voice model are kept. The story therefore resets once after an update, and a demo left open before the update shows the new behaviour (this is how a pre-voice preset gained **Voice Agent**). A state with no preset (the presenter's own panel changes) is left alone (D-108). Adding a preset changes no stored one, so the Trade mapped and Group instructor presets came in without a bump. Unlike choosing a preset, the refresh does not clear verification passes or reset face registration.

## Logging in during a demo

The first login screen shows a yellow **Demo accounts** list under the Institute code field, always open (D-157, supersedes D-058). It lists all seven people by their persona title (Open instructor, Trade-mapped instructor, Batch-mapped instructor, Timetable instructor, Employability Skills instructor, Group instructor, Principal), with the person last picked in the panel marked. **Logging in takes three taps and no typing:**

1. Tap a person. That sets up their story, as their preset would (configuration, simulation, the 10:15 clock, face registration), fills the institute code and looks it up.
2. _Is this your institute?_ → **Yes**. The Trainer ID step is skipped: the picked person is looked up.
3. _Is this you?_ → **Yes** → Home.

The audience still sees both confirmations, and nothing is confirmed for you. While a lookup runs, the tapped row shows progress and the others wait. **Not you? Change Trainer ID** on _Is this you?_ forgets the pick, so the next step asks for a Trainer ID as usual. Typing a different institute code also forgets it. On the **First-time user** story, tapping _Open instructor_ keeps the first-time story (face not registered, permissions not asked), so signing in leads to face registration. Production builds don't have the list.

**Sign in as** (top of the panel) signs straight in with that person's story: open the panel, tap the row (two taps). **Show the login screens** signs out and opens the first login screen, with the current person marked in Demo accounts.

To type instead (for example to show the Trainer ID field):

| Person                                | Institute code | Trainer ID |
| ------------------------------------- | -------------- | ---------- |
| Rajesh Patil · Open instructor        | 27410          | TR-10432   |
| Sanjay More · Trade-mapped            | 27410          | TR-10455   |
| Sunita Jadhav · Batch-mapped          | 27410          | TR-10518   |
| Vikas Shinde · Timetable              | 27410          | TR-10377   |
| Meera Kulkarni · Employability Skills | 27410          | TR-11024   |
| Yogesh Dalvi · Group instructor       | 27410          | TR-10390   |
| Dr. Anil Deshmukh · Principal         | 27410          | PR-2741    |

## The panel

The panel is ordered by what a presenter does (D-157):

1. **Sign in as**: the seven people (a tap signs straight in with that person's story), then **Show the login screens**.
2. **Stories**: First-time user and Offline.
3. **Quick settings**, always open: the few things changed during a demo.
4. **Advanced**, collapsed: everything else.
5. **Data**, then **Reset demo**.

The title bar reads _DEMO — not part of the product_ with who is signed in, the network and the language. Quick login and Skip login screens are gone.

| Quick settings | Controls |
| -------------- | -------- |
| Voice Agent    | Off / On (only `voice.enabled`; limits and marking style stay as configured). While on, **Voice model: Live / Scripted** (Scripted: no mic, no network), used from the next Voice Agent start. Presets keep the voice model. |
| Time of day    | The demo clock: 7:30, 10:15, 11:30, 2:30 PM, Real |
| Network        | Online / Offline / Pending sync (a record waiting after a failed automatic attempt, D-064) |
| Language       | English / मराठी |

| Advanced         | Controls |
| ---------------- | -------- |
| Verification     | Location: Off / Geo tagging / Geo fencing. **Location source: Simulated / This device (GPS)**. While simulated, Where is the phone: Inside / Outside / Denied / No GPS. Face verification: On/Off. Face registered: Yes/No. **Camera: This device / Simulated.** With this device: **Face detection: On-device / Guided only**. With Simulated: Registration: Works / Dark / 2 faces / Fails. **Face match (simulated): Matches / No match.** Permissions: Allowed / Ask first (location, and the simulated camera; a real camera asks the browser) |
| Marking          | Frequency: Once / Twice / Periods. Default: Present / Absent / Blank. Half day (+ Ask which half), Leave, OJT (from ERP) |
| Time             | Time fencing On/Off |
| Staff attendance | Staff attendance, Self attendance, Principal marks staff |
| Sync             | Next sync: Works / Fails |

The panel has no switch for own attendance first or the self-check reuse (`staff.selfBeforeStudents`, `verification.selfPassReuseMinutes`): they follow the Maharashtra configuration. To show a class without the step, sign in as someone who marked themselves this morning (Sunita, Vikas, Meera or Yogesh).

Any configuration change starts a new session: verification passes are cleared and every screen re-renders from the new journey. **Disabled features disappear** from the flow; they are never greyed out.

**Data** sits below Advanced, above **Reset demo**: _Shared (Supabase)_ or _This device_ (a switch only when the build has a Supabase project; otherwise it just reads _This device_). On the shared source it adds **Reset shared demo data**. See scripts 15 and 16.

## Demo scripts

### 1. Own attendance, then a batch, with one face check (Open instructor)

1. Preset **Open instructor** → Home greets Rajesh by the real time of day. Its first card, under the greeting, is _My attendance_: _Mark your own attendance before your classes._ with **Mark my attendance** (D-152). Below it are the notice strip and _Today's attendance_ with the trade list (_Choose a trade, then a batch_). The navigation is just **Home · Reports**: today's work is on Home (D-052).
2. Tap **Electrician**: every class row says _Mark your attendance first_ instead of _Mark attendance_. A class URL typed into the address bar shows the same step on a full screen (_Mark your attendance first_ · _Mark my attendance_ · _Go back_), and no check runs.
3. **Mark my attendance** → the check runs on a full screen: _Checking your location…_ → _Location verified_ → _Look at the camera_ (the **live front camera**, with _Hold still_ once a face is found) → _Identity verified_. The note under it says it's a prototype: photos aren't saved and matching is simulated. → **Mark present** → _Attendance marked_ → **Done**. The step leaves Home.
4. **Electrician** → **Shift 1 · Unit 2**: _Verified a moment ago_, and the roster opens. A self check from the last 10 minutes also opens the next class, so the trainer looks at the camera once, not twice. **The demo clock is frozen, so in a demo this reuse never runs out**: every class that day opens on the morning's self check. To show the limit, move _Quick settings → Time of day_ to 11:30 (more than 10 demo minutes later) and open another class: its full check runs again.
5. The roster opens with everyone **Present**. Set two students to **Absent**; the tiles update (31 · 29 · 2) and their controls turn red (rows stay white, D-070).
6. **Review & Submit** → the absent list and _After you submit, this attendance can't be edited._ → **Submit attendance** → _Attendance submitted_. The Review screen is the one confirmation: there is no second sheet (D-149).
7. Back on Home, the batch is under _Submitted today_. Open it again: it is **locked** ("can only be corrected by the principal today").

For a class without the step, use **Batch mapped**, **Timetable** or **Employability Skills**: those trainers marked themselves this morning. The principal is never asked.

### 2. Location and face problems

On **Open instructor** the first check of the day is My attendance's own (script 1), and every problem below appears there too; on **Batch mapped** it is the batch's check.

1. In the panel (Advanced): _Where is the phone_ → **Outside** → open any open batch (or **Mark my attendance**) → _You're outside your institute · You are 1.24 km away_ → **Check again**.
2. **Denied** → _Location access is off_; **No GPS** → _Location is turned off_.
3. _Face match (simulated)_ → **No match** → _We couldn't verify your face_ → Try again.
4. Block the camera in the browser (site settings) → _Camera access is blocked · Allow camera access for KSK Attendance in your browser or phone settings, then try again_ → allow it → **Try again**. With _Camera: Simulated_, the same screen appears when the demo refuses the camera.
5. _Location_ → **Off** and _Face verification_ → **Off**: the verification screen disappears entirely and batches open straight to the list.

### 3. The mapping models (Batch mapped, Timetable, Employability Skills)

1. **Batch mapped**: only two cards; tap _Shift 2 · Unit 2_ → _Attendance isn't open yet · opens at 2:00 PM_.
2. **Timetable**: periods in time order; _Not marked · closed at 8:00 AM_; Period 2 _Submitted 9:52 AM_; Period 3 **Now** → mark it ("Period 3 · Theory" on the roster).
3. **Employability Skills**: "Employability Skills · 5 batches in 4 trades", grouped by trade. Marking Electrician Shift 1 · Unit 1 here creates the ES record and doesn't touch Rajesh's daily record for the same batch.

### 4. Principal: overview, correction, staff

1. Preset **Principal** → "Good morning, Principal" (by the real time of day, D-151), _4 of 17 batches submitted_, _9 Shift 2 batches open at 2:00 PM_, _Needs attention_ (two names, then _and N more_). The Attendance tab's trade rows add up to the same 4 of 17, and each says what is next under its count (_2 not submitted_, _Opens at 2:00 PM_, D-077).
2. **Attendance → Electrician → Shift 1 · Unit 1** (submitted 9:48 AM by Kalpana Borse) → tap the pencil on **Rahul Kumar** (Absent).
3. Choose **Present**, pick the reason _Student arrived late_ (or type one; a reason is required) → **Save correction**. The row shows _Corrected by principal_, and **Reports → More reports → Correction log** shows the entry with old → new, reason, who and when. The original record is untouched.
4. The record shows only today's session, the one it was opened for: there is no Today/Yesterday switch (D-150). Earlier days are in Reports (the monthly register, script 14). A past-date record URL typed by hand still opens read-only ("Attendance from previous days can't be corrected").
5. **Attendance → Staff**: self-verified staff are locked; mark the rest Present/Absent → **Save n changes** → confirm in the sheet (the staff save keeps its sheet: it is the only confirmation). With unsaved marks, leaving (Students, or any navigation) asks _Discard n changes?_ first.
6. **Staff report (D-154).** **Reports** → _Staff attendance_ (between At-risk students and Offline data): this month's figure captioned _Attendance_, staff-days present and absent, and _5 staff not marked today_. Below it every staff member, lowest first, the principal as _Dr. Anil Deshmukh (you)_; tap one for their days. Days nobody marked are shown apart as _Not marked_, never counted as absent. **Staff register** on the section's title line downloads this or last month's staff register (`KSK-staff-register_<yyyy-mm>.html`); **Choose dates · print** opens the detail report. The Institute card no longer shows a staff %, and _More reports_ keeps only the Correction log.
7. **Principal offline (D-153).** _Quick settings → Network_ → **Offline** → **Mark staff attendance** → mark Sanjay More present → **Save 1 change** → confirm → _Saved on this phone · will sync automatically_. Home's **Sync pending** card counts it, and **See what's waiting** opens Offline data, which names it _Staff attendance · Sanjay More_ and also lists the downloaded batches (the principal can mark students, so packs are there too). Network → **Online** → _All attendance synced_.

### 5. Offline marking and sync

1. Preset **Offline** → the banner reads _You're offline. Attendance will sync automatically._ Rajesh has not marked himself yet: **Mark my attendance** first (script 1). It saves on the phone too and waits to sync, listed as _My attendance_ in Offline data, so the Sync pending counts below include it.
2. Open a downloaded batch (Electrician Shift 1 · Unit 2) → mark → submit → _Saved on this phone_.
3. Open **Fitter · Shift 1 · Unit 2**: _Student list downloaded on … New admissions may be missing._
4. Open a batch that wasn't downloaded (Mechanic Diesel) → _This batch isn't downloaded_.
5. **Done** → Home shows **Sync pending** · _2 attendance records waiting_ (the batch and his own attendance) · _It will sync when you're back online_ (D-064). Panel → Network **Online** → _Syncing attendance…_ → _All attendance synced_, and the card goes away. For the failure path, set _Next sync_ → **Fails** first: the card says _Couldn't sync_ and offers **Try again**.
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

Tap the avatar (top right) → Language **मराठी** (or _Quick settings → Language_ in the panel). Every screen switches to Marathi in Mukta, with Latin digits (D-012). Names stay in Latin script. Switch back to English the same way.

### 8. First-time user

Preset **First-time user** → under **Demo accounts** tap **Open instructor** (or type **27410**, then **TR-10432**) → _Is this your institute?_ → **Yes** → _Is this you?_ → **Yes** → _Set up face verification_ → _Start_ → _Camera required_ → _Allow camera_ (the browser asks) → the live camera takes **three photos**: _Look straight_ → _Turn slightly left_ → _Turn slightly right_, each appearing as a thumbnail → _Face registered successfully_ → Home, which starts with _My attendance_ (own attendance first, script 1). The first check then asks for location permission first.

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
5. Preset **Principal** → Reports: _Institute attendance_ (one figure, its facts and a 3-month trend; 417 students, 17 batches), _Batch attendance_ for all 17 batches grouped by trade, at-risk students across the institute, then _Staff attendance_ for this month (script 4, step 6). Under _More reports_ is the Correction log, with a date range and **Print / Save as PDF**.

Early in a month, _This month_ covers only a few days, so the percentages swing. That is the real figure, not a fault.

### 11. Voice Agent

Voice Agent lets the trainer choose the batch, pass verification, mark exceptions and submit by speaking, while the screen follows along (D-078–D-156). Since D-139 to D-141 it also answers reports questions, marks the trainer's own attendance, and serves the principal (scripts 12 and 13); since D-151 to D-156 it greets by the real time of day, asks for the trainer's own attendance first, and handles staff attendance in the second person. It is the round mic button at the bottom-right corner of every signed-in screen (a **Voice Agent** pill from 1136px). It floats over the screen and never takes layout space: it sits at the same corner on every screen, above the footer and the bottom navigation, and every row can scroll clear of it (D-147). Tap it and it grows into the voice card, showing _Listening_, with **Pause**, **Resume voice** and **Stop voice**: one row on phones, a 360px two-line card from 600px; tap the status for the extras. After about 6 seconds with nothing new the card rests as the round status button and opens again when the agent speaks or needs you; a manual **Minimize** stays until you tap it. While the face camera is on the microphone is off, and the card says _Mic off for face check_. A busy moment shows _Working…_. Short tones mark ready, saved and ended. Taps keep working the whole time, and the model is told about each one.

**Live (Gemini), the real thing.** It needs:
- `GEMINI_API_KEY` set on the server, in a git-ignored env file: here `.env.development` (ignored by `.gitignore` line 58, even though an earlier line un-ignores it; `npm run voice:spike-token`, `voice:spike-voices` and `test:voice-live` load that file with `--env-file`), or the Vercel project settings. Never in a `NEXT_PUBLIC_` variable, never committed (see `.env.example`). Restart `npm run dev` after adding it. Without it voice says _Voice isn’t available right now_ and the screen keeps working.
- a microphone, a connection, and HTTPS or `localhost`. Earphones help in a noisy room.

It works in `npm run dev` as on Vercel (D-158): an edit to services, repositories, config or domain code stops a running voice session and rebuilds the app container (start voice again), and in development the voice debug lines show in the console without `?voiceDebug=1`.

Then: preset **Open instructor** → _Quick settings → Voice model_ → **Live** (the default; the choice shows only while voice is on) → the floating **Voice Agent** button (bottom-right) → allow the microphone. One soft voice speaks English and Marathi in a calm manner (D-155). **The self-first story** (D-151, D-152):

1. The agent greets Rajesh by the real time of day and asks for his own attendance first: "Hi Rajesh, good morning. Please mark your attendance first. Shall I start?"
2. Say "yes". My attendance opens and runs its location and face check; the agent says "Checking your location, then please look at the camera." and waits for the screen, and the screen waits for the agent's line (D-148). When it passes, the agent saves the mark and, in the same turn, names only the trades with a batch open and not yet marked: "Right now only Electrician, Fitter and Mechanic Diesel have batches open and not yet marked. Which one?" Ask "Why only these? I can see five trades": it gives the reason (Welder and COPA are submitted, or open later) and asks again.
3. Say the trade, then the batch ("Electrician", "shift one unit two"). The batch opens with **no second check**: the self check from a moment ago is reused, and in a frozen-clock demo it never expires (script 1). Before the self mark, asking for a batch gets the reason ("your own attendance comes first") and nothing opens.
4. The agent asks who is absent. Say the exceptions ("Aditi absent"; it asks "anyone else?"), then "that's all" or "submit". The agent reads the counts and asks; when it has finished asking, say yes (a yes said over the question is asked again, D-112).

What to say about privacy: the voice is processed by Google to run Voice Agent, nothing is recorded, and captions stay in memory.

**Scripted (no mic, no network), for a room without either.** _Quick settings → Voice model_ → **Scripted**. Voice Agent then talks to a stand-in model that says nothing on its own: you play the model from the browser console with `window.__kskDemo.voice`, exactly as the E2E tests do (`tests/e2e/voice.spec.ts`):

```js
const v = window.__kskDemo.voice;
await v.toolCall('mark_my_attendance');   // own attendance first (D-152): My attendance runs its check and saves
v.emit({ turnComplete: true });           // the agent said its check line: the camera waits for it (D-148)
// once the screen says "Attendance marked":
await v.toolCall('select_trade', { trade: 'Electrician' });          // Home → the Electrician batches
await v.toolCall('select_batch', { batch: 'shift 1 unit 2' });        // the roster, on the self check from a moment ago
await v.toolCall('set_student_status', { student: 'Aditi', status: 'ABSENT', heard: 'Aditi absent' });
const ask = await v.toolCall('submit_attendance');                    // opens the review, asks for a code
v.emit({ turnComplete: true });   // the model's asking turn ends
v.speak('yes');                   // the trainer answers: a code needs a new trainer turn after the question (D-112)
await v.toolCall('submit_attendance', { confirm_token: ask.confirm_token }); // one clear yes submits
v.texts();      // every [APP] message the app sent the model (taps, verification, the kickoff)
v.denyMic();    // the next start finds the microphone blocked: "Microphone is blocked…"
v.drop();       // the connection drops: "Voice disconnected… Tap Reconnect"
```

`speak(text)`, `emit(event)`, `responses()`, `earcons()` (the tones played), `playing(on)` (the agent "speaks", so the checks wait for it) and `goAway(ms)` are there too. Before the self mark, `select_trade` answers `SELF_FIRST` on Open instructor; on Batch mapped the kickoff opens Sunita's only open batch itself. A configuration change from the panel stops voice (a new session start); switching Voice Agent **Off** removes the button and the card.

### 12. Voice for an instructor: only what is open, then reports and own attendance

Use **Live (Gemini)** with a microphone, or **Scripted** and the console calls shown.

1. **Only open batches (D-134).** Preset **Employability Skills** (Meera, 10:15) → Voice Agent. The agent names only the three batches open now (Electrician Shift 1 · Unit 1, Fitter Shift 1 · Unit 2, COPA Shift 1 · Unit 1) and never the two that open at 2:00 PM. Ask for "Shift 2 Unit 3 Electrician": it says it opens at 2:00 PM.
2. **Auto-open (D-134).** Preset **Batch mapped** (Sunita, who marked herself this morning) → Voice Agent. Only Shift 1 · Unit 2 can be marked, so the agent opens it at once: "Hi Sunita, good morning." and "Checking your location, then please look at the camera." The check runs; then "31 students, all present. Who is absent?". **Timetable** (Vikas) opens Period 3 the same way. Auto-open happens only when the trainer's own attendance is not pending: Rajesh is asked for his first (script 11).
3. **Absentees and submit (D-135).** Say "sab present, sirf Aditi absent" (or "Aditi absent", then "that's all"). The agent asks in one line: "30 present, 1 absent: Aditi Joshi. Submit? It is final." When it has finished asking, say "haan" or "yes".
4. **Next batch (D-134, D-142).** Preset **Open instructor**, after his own attendance: after both Electrician batches are submitted the agent offers "Shift 1, Unit 2, Fitter" next; "haan" opens it. When nothing else can be marked it says why and asks "How can I help?": voice stays on until you say "stop" or it goes idle (2 minutes).
5. **Reports questions (D-140).** Still on **Open instructor** (Rajesh), ask "How is Electrician Shift 1 Unit 1 doing?", "Who is at risk?" or "Which student has the lowest attendance?". The agent answers in one or two sentences with the app's own figures (it names the lowest three at-risk students), then asks whether to show it. Say yes: Reports opens with that batch expanded and scrolled into view, or the at-risk section. Scripted: `await v.toolCall('get_batch_report', { batch: 'electrician shift 1 unit 1' }); await v.toolCall('show_report');` Name the trade: after step 4 his reports also hold Fitter Shift 1 · Unit 2, so a bare shift and unit can match more than one batch, and the agent then asks which.
6. **Register by voice (D-140).** On **Open instructor**: "Download last month's register for Electrician Shift 2 Unit 1": Reports opens with the register sheet, that batch and last month already chosen. Tap **Download** (a browser download needs your tap). Scripted: `await v.toolCall('download_register', { target: 'shift 2 unit 1', month: 'LAST_MONTH' });`
7. **Own attendance (D-141, D-152).** On a trainer who has not marked yet, voice asks first (script 11). Otherwise "Meri attendance lagao" or "mark my attendance": My attendance opens and runs the same location and face check as a tap; when it passes, the agent saves the mark and says "Your attendance is marked present at 10:15 AM." Ask again: it says it is already marked. With _Where is the phone_ → **Outside**, the check fails, the agent says why, and nothing is marked (there is no override).

### 13. Voice for the principal: today's overview, staff marking, insights

Preset **Principal** → Voice Agent (the button is there for the principal too, D-139).

1. **Overview (D-151, D-156).** The agent greets by the real time of day and says today's state in one line, the principal's own attendance included: "Good morning, Principal. 4 of 17 batches are in; 5 staff haven't marked yet, including you. How can I help?"
2. **Screens and notices.** "Open staff attendance" opens Attendance → Staff. "Open offline data" opens Offline data (D-153). "Any notices today?" reads up to three notices with their dates and offers to open them; "haan, kholo" opens Home with the Announcements sheet.
3. **"Who hasn't marked?"** The agent names up to five, **"you" first** and never the principal's own name (in today's story: you, Rajesh Patil, Sanjay More, Pradeep Gawde and Asha Naik).
4. **"Mark me present"** ("mujhe present karo", "माझी हजेरी" work too). The staff screen opens with the principal's own row outlined, and the agent asks "Mark yourself present for today? It is final." Nothing is saved yet. Say "haan": the row shows _Marked by principal_, locked, a short tone says it is saved, and the agent offers the next person not marked yet, by name, with the outline moved to that row: "… Next is Rajesh Patil. Mark Rajesh Patil present for today? It is final." One yes marks them; each person needs their own yes.
5. **"Mark everyone else present."** One question with the count: "Mark the other 4 staff present? It is final." (", you included" while the principal is still among them). One "haan" saves every row as _Marked by principal_. The yes is bound to exactly those people: any staff change in between (someone marks themselves) voids it, and the agent asks again. In "Pradeep absent, everyone else present", Pradeep's question comes first, so "everyone else" never marks him present. Someone who marked themselves is never overwritten: the agent says their own mark stands.
6. **Staff report (D-154).** "How is staff attendance this month?" The agent gives this month's figure and the lowest few in one or two sentences, then offers to show it; a yes opens Reports at _Staff attendance_. "Download last month's staff register" opens the register sheet on _All staff_ and last month; tap **Download**.
7. **Insights (D-140).** "How is Electrician Shift 1 Unit 2 doing?", "How many students are at risk across the institute?" or "How is the institute this month compared with last month?" The answers are the app's figures; a yes shows the matching report. Corrections are not done by voice: they stay on the record screen with a reason.

Scripted: `const ask = await v.toolCall('mark_staff', { staff: 'me', status: 'PRESENT' }); v.emit({ turnComplete: true }); v.speak('haan'); await v.toolCall('mark_staff', { staff: 'me', status: 'PRESENT', confirm_token: ask.confirm_token });`, and for everyone else `toolCall('mark_remaining_staff', { status: 'PRESENT' })` the same way. `get_staff_today`, `get_staff_report`, then `show_report`, and `download_register` with `target: 'staff'` play steps 3 and 6.

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
2. **Phone** (or a second browser profile): preset **Batch mapped** (Sunita). Panel → _Quick settings → Time of day_ **2:30 PM**, so Shift 2 · Unit 2 is open. Open it, mark one student absent, review and submit.
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
- **No microphone, no network or no Gemini key:** _Quick settings → Voice model → Scripted_ (script 11). Presets keep this choice.
- **No Voice Agent button although the panel says Open instructor:** this browser kept the demo state from before this round. Tap **Reset demo** once (or a _Sign in as_ row).
- **A class says _Mark your attendance first_:** that is own attendance first (D-152), not a fault. Mark it (script 1), or sign in as Sunita, Vikas, Meera or Yogesh.
- **The greeting says _Good evening_ at 10:15:** the greeting follows the real time, the classes follow the demo clock (D-151).
- **The shared data looks used up** (a batch already submitted by an earlier presenter): **Reset shared demo data** (script 16), or switch the Data row to **This device** for a private story.
- **The shared project does not answer:** a free Supabase project pauses after a period without use; restore it from the Supabase dashboard (`docs/SUPABASE.md`), or switch to **This device**.
- **What to say about face checks:** the camera and the movement check are real and run on the phone; **matching is simulated**, nothing is saved or sent, and it is **not** secure biometric verification (a photo or video held up to the camera can pass). Production needs a certified matching and liveness provider (D-048).
