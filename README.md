# Vanguard Grading Engine

A single file, fully client side grading console for trimester results. Upload a marks sheet, validate it, pick a course, confirm the grade bands, review, and export a CSV.

No backend, no database, no build step, no account, no uploads. Data never leaves the browser.

## Quick start

1. Open `index.html` (or `BITS_Digital_CodeForge_Challenge.html`) in any modern browser.
2. Drag in a marks file: `dummy_valid_marks.xlsx` for a clean run, `dummy_edge_cases.xlsx` to see validation handling.
3. Pick a course, adjust the grade bands if you want, then Finalize and Export.

## What it does

- **Import.** Reads `.xlsx`, `.xlsm`, `.xls`, `.xlsb` and `.csv`. Finds the header row itself and matches columns by name.
- **Validate.** Checks every row. Bad rows are excluded from grading but kept in a downloadable issues log.
- **Grade.** Eight bands, `A` to `E`, that cascade automatically when you edit a boundary.
- **Analyze.** Live histogram, standard deviation, pass rate, grade spread and a student search.
- **Export.** An RFC 4180 CSV with a UTF-8 BOM, plus a review dialog before anything is written to disk.

## Grade bands

| Grade | Default band |
|-------|--------------|
| A | 80 to 100 |
| A- | 60 to 79 |
| B+ | 55 to 59 |
| B | 50 to 54 |
| B- | 45 to 49 |
| C | 40 to 44 |
| C- | 35 to 39 |
| E | 0 to 34 |

Pass mark is 40. Only a band's minimum is editable; its maximum is derived, so the bands always tile 0 to 100 without gaps or overlaps. Export stays blocked while any student falls outside the bands.

## Test data

- `dummy_valid_marks.xlsx`: a clean cohort with no validation issues.
- `dummy_edge_cases.xlsx`: duplicate BITS IDs, out of range and non numeric marks, missing fields, percentage cells, and a course where every row is invalid.

## Tests

```
cd tests
npm install
npm run verify     # node test.js && node browser-qa.js
```

`test.js` runs 36 assertion groups in jsdom. `browser-qa.js` drives the real page in headless Edge and checks the canvas, layout at five widths, touch targets, keyboard access and console hygiene. See `BUG_FIX_LOG.md` for every defect these guard against.

## Deploying

The app is static. Drop `index.html` on GitHub Pages, Vercel, Netlify or any file host. Tailwind, GSAP and SheetJS load from CDNs, with a second CDN as fallback for SheetJS, so the page needs internet access on first load.