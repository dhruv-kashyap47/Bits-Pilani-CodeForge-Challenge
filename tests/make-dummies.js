/* Regenerates the two test workbooks shipped with the submission.

   dummy_valid_marks.xlsx  realistic, fully valid multi-course cohort
   dummy_edge_cases.xlsx   one deliberately broken cohort

   Schema is exactly the challenge schema, in this order, on row 1:
     BITS ID | Course | Total Marks

   Usage:  npm install   (xlsx is the only dependency)
          node make-dummies.js

   Both files are deterministic: the same bytes come out on every run.
*/
"use strict";

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const OUT_DIR = path.join(__dirname, "..");
const HEADER = ["BITS ID", "Course", "Total Marks"];

/* Deterministic LCG so regenerating never changes the shipped files. */
function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function gauss(rand) {
  const u = Math.max(rand(), 1e-9), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function round1(x) { return Math.round(x * 10) / 10; }

/* Every grade boundary, so a test can assert the exact band each mark lands in. */
const BOUNDARY_MARKS = [100, 80, 79, 70, 69, 60, 59, 50, 49, 40, 39, 30, 29, 20, 19, 0];

function bitsId(year, seq) { return year + "A" + String(seq).padStart(3, "0"); }

function buildValid() {
  const rand = rng(20260927);
  const rows = [];
  const cohorts = [
    { course: "CSEC301", n: 34, mean: 66, sd: 18, year: 2024, start: 101 },
    { course: "CSEC405", n: 26, mean: 71, sd: 14, year: 2024, start: 201 },
    { course: "MATH201", n: 22, mean: 58, sd: 22, year: 2024, start: 301 },
  ];

  cohorts.forEach(function (c) {
    const first = rows.length;
    for (let i = 0; i < c.n; i++) {
      let m = Math.round(c.mean + gauss(rand) * c.sd);
      if (m < 0) m = 0;
      if (m > 100) m = 100;
      rows.push([bitsId(c.year, c.start + i), c.course, m]);
    }
    /* Pin the first sixteen IDs of every cohort to the exact grade boundaries,
       including 0 and 100, so all eight bands are guaranteed to be populated. */
    BOUNDARY_MARKS.forEach(function (m, k) {
      rows[first + k] = [bitsId(c.year, c.start + k), c.course, m];
    });
  });

  /* Two students on numeric-only IDs, the other common BITS ID shape.
     The long one is still well inside the IEEE-754 safe-integer range. */
  rows.push(["2024001234", "CSEC301", 77]);
  rows.push(["2024001234567", "CSEC301", 58]);

  /* A fourth course so "one row per course" and course folding have material. */
  rows.push(["2024B0001", "ECON202", 91]);
  rows.push(["2024B0002", "ECON202", 84]);
  rows.push(["2024B0003", "ECON202", 33]);
  rows.push(["2024B0004", "ECON202", 12]);
  rows.push(["2024B0005", "ECON202", 47]);

  return [HEADER].concat(rows);
}

function buildEdge() {
  const rows = [];
  const push = (id, course, marks) => rows.push([id, course, marks]);

  /* --- 1. A clean baseline course so the file is not all red ------------- */
  push("2024D001", "CSEC501", 88);
  push("2024D002", "CSEC501", 76);
  push("2024D003", "CSEC501", 64);
  push("2024D004", "CSEC501", 41);
  push("2024D005", "CSEC501", 100);
  push("2024D006", "CSEC501", 0);

  /* --- 2. Duplicate BITS IDs, exact and case-folded ---------------------- */
  push("2024D010", "CSEC502", 72);
  push("2024D010", "CSEC502", 95);      /* exact duplicate, second value differs */
  push("2024d010", "CSEC502", 33);      /* same ID, different case */
  push("2024D011", "CSEC502", 51);
  push("2024D011", "CSEC502", 12);      /* exact duplicate again */
  push("2024D012", "CSEC502", 68);

  /* --- 3. Invalid marks: out of range ------------------------------------ */
  push("2024D020", "CSEC503", 105);     /* above 100 */
  push("2024D021", "CSEC503", 100.6);   /* above 100 before rounding */
  push("2024D022", "CSEC503", -4);      /* below 0 */
  push("2024D023", "CSEC503", -0.4);    /* below 0, but would round to 0 */
  push("2024D024", "CSEC503", 82);      /* the only clean row in this course */
  push("2024D025", "CSEC503", 71);      /* the other clean row */

  /* --- 4. Invalid marks: not a number ------------------------------------ */
  push("2024D030", "CSEC504", "N/A");
  push("2024D031", "CSEC504", "absent");
  push("2024D032", "CSEC504", "-");     /* a lone minus sign */
  push("2024D033", "CSEC504", "1e2");   /* scientific notation as text */
  push("2024D034", "CSEC504", "82,5");  /* comma decimal separator */
  push("2024D035", "CSEC504", "82%");   /* percentage-formatted text */
  push("2024D036", "CSEC504", 74);

  /* --- 5. Missing values -------------------------------------------------- */
  push("2024D040", "CSEC505", null);        /* empty marks cell */
  push("2024D041", "CSEC505", "   ");       /* whitespace-only marks */
  push("2024D042", "CSEC505", 69);
  push("",           "CSEC505", 61);        /* empty BITS ID */
  push("   ",        "CSEC505", 55);        /* whitespace-only BITS ID */
  push("2024D044", "", 49);                 /* empty course */
  push("2024D045", "   ", 44);              /* whitespace-only course */
  push("2024D046", "CSEC505", 43);

  /* --- 6. Percentage-formatted number cells (0-1 range) ------------------ */
  push("2024D050", "CSEC506", 0.82);        /* really 82 out of 100 */
  push("2024D051", "CSEC506", 0.5);         /* really 50 out of 100 */
  push("2024D052", "CSEC506", 67);
  push("2024D053", "CSEC506", 73);

  /* --- 7. Fractional marks: rounded and reported -------------------------- */
  push("2024D060", "CSEC507", 80.2);
  push("2024D061", "CSEC507", 63.5);
  push("2024D062", "CSEC507", 41.4);
  push("2024D063", "CSEC507", 39.6);
  push("2024D064", "CSEC507", 25);

  /* --- 8. Marks stored as text, with padding ------------------------------ */
  push("2024D070", "CSEC508", " 77 ");
  push("2024D071", "CSEC508", "012");
  push("2024D072", "CSEC508", "+64");
  push("2024D073", "CSEC508", 66);

  /* --- 9. Course-name variants that must fold into one course ------------- */
  push("2024D080", "CSEC  510", 81);
  push("2024D081", "csec510", 66);
  push("2024D082", " CSec510 ", 52);
  push("2024D083", "CSEC510", 37);
  push("2024D084", "CSEC 510", 19);

  /* --- 10. A course where every single row is invalid --------------------- */
  push("2024D090", "CSEC511", 120);
  push("2024D091", "CSEC511", "n/a");
  push("2024D092", "CSEC511", -1);

  /* --- 11. Boundary marks on a healthy course ---------------------------- */
  push("2024D100", "CSEC512", 100);
  push("2024D101", "CSEC512", 80);
  push("2024D102", "CSEC512", 79);
  push("2024D103", "CSEC512", 70);
  push("2024D104", "CSEC512", 69);
  push("2024D105", "CSEC512", 60);
  push("2024D106", "CSEC512", 59);
  push("2024D107", "CSEC512", 50);
  push("2024D108", "CSEC512", 49);
  push("2024D109", "CSEC512", 40);
  push("2024D110", "CSEC512", 39);
  push("2024D111", "CSEC512", 30);
  push("2024D112", "CSEC512", 29);
  push("2024D113", "CSEC512", 20);
  push("2024D114", "CSEC512", 19);
  push("2024D115", "CSEC512", 0);

  /* --- 12. Whitespace and casing in the BITS ID --------------------------- */
  push("  2024D120  ", "CSEC513", 84);
  push("2024D121", "CSEC513", 59);
  push("2024D122", "CSEC513", 31);

  return [HEADER].concat(rows);
}

function write(name, aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 13 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Marks");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, buf);

  /* Re-read the bytes we just wrote and assert the schema survived. */
  const check = XLSX.read(fs.readFileSync(file), { type: "buffer" });
  const back = XLSX.utils.sheet_to_json(check.Sheets[check.SheetNames[0]], { header: 1, raw: true, defval: null });
  const head = back[0].map((c) => String(c));
  if (head.join("|") !== HEADER.join("|")) {
    throw new Error(name + ": header round-trip failed: " + head.join("|"));
  }
  if (back.length !== aoa.length) {
    throw new Error(name + ": expected " + aoa.length + " rows, read back " + back.length);
  }
  console.log("wrote " + name + "  (" + (back.length - 1) + " data rows, " + buf.length + " bytes)");
  return { name: name, rows: back.length - 1 };
}

console.log("Building test workbooks with schema: " + HEADER.join(" | "));
const valid = write("dummy_valid_marks.xlsx", buildValid());
const edge = write("dummy_edge_cases.xlsx", buildEdge());

/* Sanity summary so a broken generator is obvious in the build log. */
const wbV = XLSX.read(fs.readFileSync(path.join(OUT_DIR, valid.name)), { type: "buffer" });
const vRows = XLSX.utils.sheet_to_json(wbV.Sheets[wbV.SheetNames[0]], { header: 1, raw: true, defval: null }).slice(1);
const byCourse = {};
vRows.forEach((r) => { byCourse[r[1]] = (byCourse[r[1]] || 0) + 1; });
const marks = vRows.map((r) => r[2]);
console.log("  valid file courses : " + Object.keys(byCourse).map((k) => k + "=" + byCourse[k]).join(", "));
console.log("  valid file marks   : " + Math.min.apply(null, marks) + " to " + Math.max.apply(null, marks));
const bands = { A: 0, "A-": 0, B: 0, "B-": 0, C: 0, "C-": 0, D: 0, E: 0 };
vRows.forEach((r) => {
  const m = r[2];
  const g = m >= 80 ? "A" : m >= 70 ? "A-" : m >= 60 ? "B" : m >= 50 ? "B-" : m >= 40 ? "C" : m >= 30 ? "C-" : m >= 20 ? "D" : "E";
  bands[g]++;
});
console.log("  valid file bands   : " + Object.keys(bands).map((k) => k + "=" + bands[k]).join(", "));
if (Object.keys(bands).some((k) => bands[k] === 0)) throw new Error("every grade band must be populated");
console.log("  edge file rows     : " + edge.rows);
