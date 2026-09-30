# Vanguard Grading Engine — BITS Digital CodeForge

A single-file, fully client-side grading console for trimester-end results. Upload a marks sheet, validate it, pick a course, confirm the grade bands, review, and export a CSV. No backend, no database, no build step, no account. 

Now completely overhauled with **elite, Awwwards-level UX/UI** using Tailwind CSS, GSAP (ScrollTrigger), and modern glassmorphism design principles.

Open `index.html` (or `BITS_Digital_CodeForge_Challenge.html`) in a browser and it runs instantly.

---

## Quick start

1. Open `index.html` in any modern browser.
2. Drag `dummy_valid_marks.xlsx` into the file input to see a clean run, or `dummy_edge_cases.xlsx` to see validation error handling.
3. Select your desired course from the dropdown.
4. The dashboard will animate in (powered by GSAP), displaying a dense analytics grid, a fully reactive histogram, and configurable grade thresholds.
5. Export your final grades securely. Data never leaves your machine.

---

## Test Data Included

### `dummy_valid_marks.xlsx`
20 clean student records spanning the `Computer Networks` course. Randomly generated integer marks designed to fall perfectly into standard grading distributions.

### `dummy_edge_cases.xlsx`
9 highly specific records testing validation boundaries:
- Negative marks (`-5`)
- Over-maximum marks (`105`)
- Missing courses
- Strings formatted as marks (`Eighty`)
- Percentages disguised as floats (`45.6`, `82%`)

---

## What the app does

**Validate.** Every row is checked before it is graded. Any row violating the BITS schema is excluded from the grading process but retained for a downloadable error log.
**Grade.** Eight dynamic, cascading bands (`A` through `E`). 
**Analyze.** Real-time standard deviation, pass rates, min/max metrics, and an interactive canvas histogram charting the bell curve of the cohort.
**Search.** Find any student ID in the cohort instantly.
**Export.** Clean, RFC 4180 compliant CSV exports formatted perfectly for university administration software.

---

## Design Aesthetics (Tasteskill v2)
The UI breaks from boring "stock AI" formats:
- **Cinematic Hero:** Max-width typographic limits enforcing 2-line maximums.
- **Glassmorphic Bento Grid:** Interlocking analytical panels styled with translucent backgrounds and subtle border glow effects.
- **GSAP ScrollTrigger:** Fluid scroll animations, staggered reveals, and responsive hover physics.
- **Dark Mode Native:** Deep blacks, violet accents, and high-contrast typography using the `Outfit` font family.

---

## Deploying
Because this is a completely static, single HTML file, you can host it anywhere instantly.

**GitHub Pages / Vercel / Netlify:**
Drop the HTML file in your repository. It deploys instantly. No `npm run build` required.

**Locally:**
Simply double click the file. It operates safely within the `file://` protocol.
