# BITS Digital CodeForge — Bug Fix Log

**Application:** `BITS_Digital_CodeForge_Challenge.html` (shipped as `index.html`)
**Test data:** `dummy_valid_marks.xlsx`, `dummy_edge_cases.xlsx`
**Verification:** `cd tests && npm run verify` → `node test.js` (36 assertion groups, jsdom) + `node browser-qa.js` (headless Edge over the DevTools protocol)

---

## Summary

| Area | Fixed | Regression coverage |
|------|------:|--------------------|
| A. Marks parsing & validation | 13 | test.js §10–§15, §21, §26–§28, §34 |
| B. Grade bands | 5 | test.js §5, §6, §24, §31, §35 |
| C. CSV export | 5 | test.js §8, §9, §35 |
| D. Timer & session state | 6 | test.js §1, §8, §19, §25, §29, §30 |
| E. State & interaction | 7 | test.js §7, §10, §19, §31, §33 |
| F. Chart & rendering | 7 | test.js §15, §16, §23 + browser-qa.js |
| G. Motion, a11y & responsive | 5 | test.js §24 + browser-qa.js |
| **Total** | **48** | all groups green |

---

## A. Marks parsing & validation

| ID | Symptom | Root cause | Fix applied | Covered by |
|----|---------|-----------|-------------|-----------|
| A1 | `-0.4` and `100.6` were graded as `0` and `100` | Marks were rounded **before** the range check, so values only inside the scale after rounding slipped through | Range-check the typed value first, round second; the console now refuses the value it was actually given (`parseMarks`) | §27 |
| A2 | A percentage cell (`82%` stored as `0.82`) was graded as a real `0.82/100` | Values in `(0,1)` are technically "valid" numbers, so validation passed them through as near-zero marks | Any value strictly between 0 and 1 is rejected by name: "looks like a percentage cell (82% is stored as 0.82)" | §27, §34 |
| A3 | Every diagnostic pointed at the wrong spreadsheet row when the used range did not start at A1 | `sheet_to_json` indexes from the sheet's first used cell, not A1, but the array index was used as the row number | Offset by `XLSX.utils.decode_range(sheet["!ref"]).s.r + 1`, so rows are named the way Excel numbers them | §26 |
| A4 | A workbook whose header sat on row 2 (a title banner above it) was rejected as "columns not found" | The header was assumed to be the first row | `findHeaderRow` scans the first `HEADER_SCAN` (8) rows and resolves columns by normalised alias | §26 |
| A5 | Missing columns produced a bare, unhelpful error | The failure surfaced as a generic parse error | Explicit message naming the three required columns, the number of rows scanned and the first row actually found | §14 |
| A6 | Uploading a `.docx`/`.pdf` said "Required columns not found" | Container type was never sniffed before parsing | `sniffContainer` detects ZIP (`.xlsx/.xlsm`), OLE2 (`.xls/.xlsb`) and delimited text, so a wrong file type gets a file-type message | §28 |
| A7 | Legacy `.xls` (BIFF8) workbooks could not be read | Only the modern path was exercised | `XLSX.read(bytes, {type:"array"})` over a sniffed container, so `.xlsx`, `.xlsm`, `.xls`, `.xlsb` and `.csv` all parse | §21 |
| A8 | With the CDN unreachable the file input was still selectable and every upload failed with an empty analytics panel | SheetJS was a single hard dependency loaded after init, with no fallback and no readiness gate | Two-CDN fallback chain, the input stays disabled until a parser exists, and an explicit "Excel library unavailable" banner is shown if both CDNs fail | §22, browser-qa |
| A9 | The same BITS ID appearing in two different courses was wrongly excluded as a duplicate | Duplicate detection was file-wide, ignoring the course | Duplicates are scoped per course: first occurrence wins, later rows are excluded and reported as a warning with the first row named | §12, §34 |
| A10 | `Course A`, `course a `, `CSEC 501` and `CSEC501` became four dropdown entries | Course identity was the raw string | `courseKey` trims, removes whitespace and case-folds; the first spelling seen is kept for display | §11 |
| A11 | Rows with a blank BITS ID, blank course or blank marks vanished with no explanation | Validation returned a single opaque verdict per row | Per-field problems (`Missing BITS ID`, `Missing Course`, `Missing Total Marks`, `… is not a number`) each carrying row, field, value and severity | §13, §34 |
| A12 | A workbook that was empty or entirely blank rows produced a confusing failure | Blank rows and empty sheets were not handled before parsing | Blank rows are skipped, an empty sheet is reported by name, and a course with no valid rows is still listed (labelled, not hidden) | §15 |
| A13 | "Rows excluded" was inflated because each failing check on a row was counted separately | The counter summed problems, not rows | Error rows are counted once per row; the export reports distinct withheld rows for the course and for the whole file, matching the Data quality panel | §8, §34 |

## B. Grade bands

| ID | Symptom | Root cause | Fix applied | Covered by |
|----|---------|-----------|-------------|-----------|
| B1 | Editing one band's minimum left inverted or overlapping bands | The change was not propagated to neighbouring bands | Strict cascade: `max(grade[i]) = min(grade[i-1]) - 1`, propagated down the whole ladder on every edit | §5, §35 |
| B2 | Both `min` and `max` were editable, so any invalid partition could be saved | Two independent inputs per band could contradict each other | `max` is derived and read-only; only boundaries are edited, so the partition stays mathematically total | §24, §35 |
| B3 | A gap between bands (e.g. `A` and `A-` leaving 20–39 ungraded) was not explained | Validation only checked for overlaps | Gaps and overlaps are both detected, named and described ("Gap or overlap between A and A-", "starts at"), and rendered as a list | §5 |
| B4 | Students outside every band were silently dropped from the export | Grading returned `null` and the row was just skipped | Ungraded students are counted, listed as a blocker, and `buildCsv` refuses to write rather than emitting a partial sheet | §6, §31, §35 |
| B5 | Band edits could produce a configuration that cannot cover the whole scale | No feasibility check on the edited ladder | A band that can no longer cover 0–100 is refused, and the underlying range fault is named in the finalize hint | §35 |

## C. CSV export

| ID | Symptom | Root cause | Fix applied | Covered by |
|----|---------|-----------|-------------|-----------|
| C1 | A course named `=SUM(A1)` executed as a formula when the CSV was opened in Excel | Cells were written raw | Spreadsheet formula-injection guard prefixes `'` to any value starting with `=`, `+`, `-`, `@`, tab or CR | §9 |
| C2 | `Q, "quoted"` was split across columns and broke the row | No RFC 4180 quoting | Proper RFC 4180 quoting: fields containing `,`, `"`, CR or LF are quoted and inner quotes doubled | §9 |
| C3 | Non-ASCII characters came out as mojibake when the CSV was opened in Excel | UTF-8 without a byte-order mark, LF line endings | UTF-8 BOM (`﻿`) + CRLF line endings, as asserted byte-for-byte in the suite | §8 |
| C4 | Filenames contained `:` (illegal on Windows) and the "Generated" stamp differed per machine | `.replace(":", "")` replaced only the first colon; the stamp used locale-dependent formatting | `replace(/:/g,"")` plus a hand-rolled, locale-independent ISO stamp so archived exports diff cleanly | manual (archive diff) |
| C5 | One stray click downloaded a grade sheet with no confirmation | The export button wrote the file directly | A `<dialog>` review step shows instructor, course, students graded, excluded counts and the full distribution before the download; focus moves into the dialog and it closes after export | §8, browser-qa |

## D. Timer & session state

| ID | Symptom | Root cause | Fix applied | Covered by |
|----|---------|-----------|-------------|-----------|
| D1 | Switching course reset the clock to `00:00`, and a 2nd attempt closed with "0 min 0 sec" | A single start timestamp, discarded on course change | Time is accumulated in two parts — `bankedMs` for stopped segments and `gradingStartTime` for the live segment — so the total survives a course switch | §29 |
| D2 | The clock read `00:00` for the first second after grading began | The first paint was left to the interval | `startTimer` paints immediately, then ticks every second | manual |
| D3 | The interval kept running after export, leaking a timer for the rest of the session | The interval handle was never cleared | `stopTimer` banks the elapsed segment and clears the interval; only a confirmed export stops the clock | §25 |
| D4 | Uploading a second file reported "2nd attempt" and continued an old timer | Attempt counter and timer lived outside the dataset reset | `resetDataset` clears `finalizeCount` and the timer on every new upload, so a new file always reads "1st attempt" | §19, §30 |
| D5 | The timer started on page load, before any grading happened | Timer was bound to `init` | The clock starts when a course with valid rows is first selected, and can be read by an `aria-label` | §1 |
| D6 | The previous course's confirmation message stayed on screen after switching | Shared node, no reset | The confirmation text is cleared on every course change | §8, §30 |

## E. State & interaction

| ID | Symptom | Root cause | Fix applied | Covered by |
|----|---------|-----------|-------------|-----------|
| E1 | A failed or wrong re-upload left the previous file's students visible on screen | The old dataset survived the new read | `resetDataset` runs before every parse, so a failed read can never leak the previous file | §10 |
| E2 | The course dropdown accumulated duplicate and stale options across uploads | Options were appended to the existing list | The `<select>` is cleared before each render, preserving only the current selection when still valid | §10 |
| E3 | Re-selecting the same file did nothing | The input's value was unchanged, so no `change` event fired | `el.file.value = ""` after each read, so the same file can be re-picked | manual |
| E4 | Export was blocked by one reason at a time, so the user fixed issues one-by-one | Only the first blocker was reported | `collectBlockers` lists everything blocking a safe export, in user-facing order, as a list | §31 |
| E5 | Dragging a grade boundary rebuilt the whole 200-row quality table, losing scroll position and the open/closed state | Every render rebuilt the data-quality panel | The panel is re-rendered only when a dataset signature actually changes | manual |
| E6 | Search gave no match count and no visual confirmation of the query | Results were rendered as plain text | Live count ("1 of 36") plus `<mark>` highlighting of the matched substring | §7 |
| E7 | The footer progress rail was static decoration that lied about the session | Steps were hard-coded markup | Each step reports the truth: `done`, `blocked`, `current` or `todo`, derived from the file, rows, bands, instructor and ungraded count | §33 |

## F. Chart & rendering

| ID | Symptom | Root cause | Fix applied | Covered by |
|----|---------|-----------|-------------|-----------|
| F1 | The histogram was blurry on HiDPI screens and did not redraw on resize | A fixed 380×240 backing store with no resize handling | Device-pixel-aware canvas sized to its CSS box, with a debounced redraw on resize; the suite asserts `canvas.width >= clientWidth` and that pixels are actually painted | browser-qa |
| F2 | Bars rendered flat/undefined-coloured | `addColorStop` was called inside a ternary expression, and a second `grad` expression was written but never used | Gradient built explicitly with `addColorStop`, with a solid-colour fallback; the suite asserts brand-coloured pixels are present | browser-qa |
| F3 | X-axis tick labels overlapped and collided | Every integer 0–100 was labelled | Labels are drawn on every other tick, with the final tick forced so the axis always ends labelled | manual |
| F4 | The normal overlay changed shape from cohort to cohort | The curve was normalised against the visible data window | Normalised against the peak of the full 0–100 domain, so the overlay means the same thing for every class | manual |
| F5 | A cohort with identical marks produced `NaN` or a meaningless bell curve | Variance 0 produced a division by zero | Population std dev returns `0`/`null` instead of `NaN`, the UI states "Every mark is identical", and the overlay becomes a single dashed marker | §16 |
| F6 | A course whose rows were all invalid showed `NaN%` pass rate | Statistics were computed over an empty set | Empty-set statistics render as `-`, and the pass panel states "No valid students" | §15 |
| F7 | `NaN` and `undefined` leaked into the first paint before any file was loaded | Placeholders were written from undefined values | Clean empty state on load; browser QA asserts neither string appears in the initial render | browser-qa |
| F8 | Em/en dashes appeared as raw HTML entities in the UI and in the CSV | `&mdash;`, `&ndash;` and numeric equivalents were used in output strings | Hyphens everywhere; the suite asserts no em/en dash in the source **and** none in the rendered text | §23 |

## G. Motion, accessibility & responsive layout

| ID | Symptom | Root cause | Fix applied | Covered by |
|----|---------|-----------|-------------|-----------|
| G1 | Elements faded in wrongly staggered and ScrollTrigger positions were stale after a dynamic re-render | GSAP animations were registered once at boot and never on re-render | Plugin registration and the stagger logic are hooked into the render path (`updateAll`) with `ScrollTrigger.refresh()`, and the whole block is guarded so a CDN failure cannot throw | manual |
| G2 | Controls were unlabelled and unreachable for keyboard and screen-reader users | Missing `label`/`aria-label`, no viewport meta, images without `alt` | Labelled course select, `aria-label` on the timer, viewport meta for mobile, alt text on every image; the export control stays focusable and reports `aria-disabled` while blocked | §24, browser-qa |
| G3 | "Hidden" panels still occupied layout, leaving holes in the grid | Elements were only flagged, not actually hidden | `[hidden] { display: none !important }`, verified via `getComputedStyle` on the banner, spread bar and issues toolbar | browser-qa |
| G4 | Horizontal overflow broke the layout at 820px, 414px and 360px | Fixed-width panels and tables | Responsive grid with a maximum content width; wide tables scroll inside `.table-wrap` instead of spilling. Asserted at 1280/1024/820/414/360px | browser-qa |
| G5 | Buttons and inputs were under 28px tall and hard to hit on a phone | Compact control sizing | Minimum 28px touch targets on every button, select and input at mobile widths | browser-qa |

---

## Redesign notes (non-defect)

- **Cinematic hero:** system fonts replaced with `Outfit`, clamp-based heading sizing so large headings never wrap into a wall of lines.
- **Bento analytics grid:** interlocking glass panels with `grid-auto-flow: dense`, so there is no empty white space; the histogram sits full-width beside the stat tiles.
- **Visual language:** deep radial lighting, translucent `glass-panel` surfaces, violet accent, custom scrollbar, dark-mode native.
- **Motion:** GSAP `ScrollTrigger` fade-ups with staggered reveals, disabled when the user prefers reduced motion.

---

## Deployment readiness

Single file, zero bundled images. Tailwind, GSAP, SheetJS and the webfont load from CDNs (SheetJS with a two-CDN fallback). Runs from `file://` or any static host with no build step, no backend, no `localStorage`, no `fetch`/XHR — enforced as assertions in §22.

## Open items

- The GSAP init block is duplicated three times in the script (leftovers from successive patch passes). It is idempotent in effect, but should be collapsed to a single call.