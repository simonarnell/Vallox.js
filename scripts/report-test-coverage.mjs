#!/usr/bin/env node
// Generates coverage/test-report.html: an HTML page styled like (and
// reusing the actual CSS from, and embedding the actual generated table
// from) Istanbul's own coverage/lcov-report/index.html, extended with a
// second section showing which ValloxClient/WebSocketTransport methods
// were *actually executed* (real per-function hit counts from Istanbul's
// coverage-final.json) by the mocked test suite and, when run, the
// real-hardware suite.
//
// Both suites must pass cleanly for their hit data to count: a method that
// executed during a failing run isn't "verified," so a failure anywhere in
// a suite zeroes out that whole column rather than reporting partial,
// possibly-misleading credit. The hardware column only ever reflects a
// suite that was actually run against real hardware in *this* invocation
// (gated on VALLOX_HOST) — never fabricated from source inspection.
//
// Regenerate with `npm run test:report`.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Istanbul's html reporter only ever adds/overwrites pages for files in the
// *current* run's coverage map — it never deletes a per-file page left over
// from a previous run whose file set was different (e.g. before cli.ts was
// excluded from collectCoverageFrom). Wipe both coverage directories before
// each run so stale pages can't linger and get served as if current.
rmSync(join(ROOT, 'coverage'), { recursive: true, force: true })
rmSync(join(ROOT, 'coverage-hardware'), { recursive: true, force: true })

// Jest's coverage here comes from V8 (this project's source is loaded via
// Node's native type-stripping, not Babel/istanbul instrumentation), and
// v8-to-istanbul doesn't reliably recover class method names — every
// function shows up in coverage-final.json as "(anonymous_N)". Its
// declaration *line number* is reliable, though, so methods are matched by
// line rather than by name: extractPublicMethods records the 1-based line
// each `async methodName(` appears on, and realHitMethods looks up
// coverage-final.json's fnMap by that same line.
function extractPublicMethods(sourcePath) {
  const source = readFileSync(sourcePath, 'utf8')
  const re = /^ {2}(?:async )?([a-zA-Z][a-zA-Z0-9]*)\(/gm
  const byLine = new Map() // line number (1-based) -> method name
  let m
  while ((m = re.exec(source)) !== null) {
    if (m[1] === 'constructor') continue
    const line = source.slice(0, m.index).split('\n').length
    byLine.set(line, m[1])
  }
  return byLine
}

const clientMethodsByLine = extractPublicMethods(join(ROOT, 'src/client.ts'))
const transportMethodNames = new Set(['getHistory', 'readRegister', 'readRegisters', 'writeRegister', 'writeRegisters'])
const transportMethodsByLine = new Map(
  [...extractPublicMethods(join(ROOT, 'src/transport/websocket.ts'))].filter(([, name]) => transportMethodNames.has(name)),
)
const METHODS_BY_FILE = {
  'src/client.ts': clientMethodsByLine,
  'src/transport/websocket.ts': transportMethodsByLine,
}
const allMethods = [...new Set([...clientMethodsByLine.values(), ...transportMethodsByLine.values()])].sort()

/** Real per-function hit counts from an Istanbul coverage-final.json — which of `allMethods` actually executed. */
function realHitMethods(coverageFinalPath) {
  if (!existsSync(coverageFinalPath)) return null
  const data = JSON.parse(readFileSync(coverageFinalPath, 'utf8'))
  const hit = new Set()
  for (const [absPath, fileCov] of Object.entries(data)) {
    const relPath = relative(ROOT, absPath)
    const methodsByLine = METHODS_BY_FILE[relPath]
    if (!methodsByLine) continue
    for (const [fnId, fnMeta] of Object.entries(fileCov.fnMap)) {
      const method = methodsByLine.get(fnMeta.decl.start.line)
      if (method && (fileCov.f[fnId] ?? 0) > 0) hit.add(method)
    }
  }
  return hit
}

/** Runs a jest config to completion. Returns 'passed', 'failed', or (mock only, never happens here) rethrows. */
function runSuite(args) {
  try {
    execFileSync('node', ['--experimental-vm-modules', 'node_modules/.bin/jest', ...args], {
      cwd: ROOT,
      stdio: 'inherit',
    })
    return 'passed'
  } catch {
    return 'failed'
  }
}

// ---------------------------------------------------------------------------
// Mocked suite — always runs. A failure here aborts report generation
// entirely rather than publishing a report built on a red build.
// ---------------------------------------------------------------------------

const mockStatus = runSuite(['--coverage'])
if (mockStatus !== 'passed') {
  console.error('\nMocked test suite failed — not generating a report from a red build. Fix the failures and re-run.')
  process.exit(1)
}
const mockHits = realHitMethods(join(ROOT, 'coverage', 'coverage-final.json')) ?? new Set()

// ---------------------------------------------------------------------------
// Hardware suite — only runs if VALLOX_HOST is set (i.e. this is actually
// being run from a machine on the unit's LAN). Never fabricated otherwise.
// ---------------------------------------------------------------------------

let hardwareState // 'not-run' | 'failed' | 'passed'
let hardwareHits = new Set()
if (process.env.VALLOX_HOST) {
  hardwareState = runSuite(['--config', 'jest.hardware.config.js'])
  if (hardwareState === 'passed') {
    hardwareHits = realHitMethods(join(ROOT, 'coverage-hardware', 'coverage-final.json')) ?? new Set()
  } else {
    console.error('\nHardware test suite failed — hardware column will show "run had failures", not fabricated coverage.')
  }
} else {
  hardwareState = 'not-run'
  console.error('\nVALLOX_HOST not set — skipping the hardware suite. Hardware column will show "not run".')
}

// ---------------------------------------------------------------------------
// Lift the real coverage-summary table straight out of Istanbul's own
// generated index.html — same markup, same numbers, same coloring.
// ---------------------------------------------------------------------------

const LCOV_INDEX = join(ROOT, 'coverage', 'lcov-report', 'index.html')
if (!existsSync(LCOV_INDEX)) {
  console.error(`Expected Istanbul's report at ${LCOV_INDEX} but it wasn't there.`)
  process.exit(1)
}
const lcovHtml = readFileSync(LCOV_INDEX, 'utf8')
const tableMatch = /<table class="coverage-summary">[\s\S]*?<\/table>/.exec(lcovHtml)
if (!tableMatch) {
  console.error("Could not find the coverage-summary table in Istanbul's report.")
  process.exit(1)
}
const istanbulSummaryTable = tableMatch[0].replaceAll('href="src/', 'href="lcov-report/src/')
const headerMatch = /<div class='pad1'>[\s\S]*?<div class='status-line[^>]*><\/div>/.exec(lcovHtml)
const istanbulHeader = headerMatch ? headerMatch[0].replace('<h1>All files</h1>', '<h1>vallox.js — test coverage</h1>') : ''

const NOTES = [
  [
    'cli.ts',
    "excluded from the file table above (collectCoverageFrom) — genuinely tested by cli.test.ts, but as a spawned subprocess, which Istanbul/V8 coverage collection can't see into, so it would only ever show a false 0% rather than no data",
  ],
  ['index.ts', 'barrel re-export file(s), no executable statements of their own'],
]

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** high = verified hit in a passing run; low = ran (or ran+passed) but no hit; medium = tier didn't run at all. */
function cell(state) {
  if (state === 'hit') return '<td class="pct high">✓ hit</td>'
  if (state === 'miss') return '<td class="pct low">not hit</td>'
  if (state === 'run-failed') return '<td class="pct medium">run had failures</td>'
  return '<td class="pct medium">not run</td>' // 'not-run'
}

const methodRows = allMethods.map((method) => {
  const mockState = mockHits.has(method) ? 'hit' : 'miss'
  const hardwareCellState =
    hardwareState === 'not-run' ? 'not-run' : hardwareState === 'failed' ? 'run-failed' : hardwareHits.has(method) ? 'hit' : 'miss'
  return `<tr>
	<td class="file">${escapeHtml(method)}</td>
	${cell(mockState)}
	${cell(hardwareCellState)}
	</tr>`
})

const mockCount = allMethods.filter((m) => mockHits.has(m)).length
const hardwareCount = hardwareState === 'passed' ? allMethods.filter((m) => hardwareHits.has(m)).length : 0
const hardwareSummary =
  hardwareState === 'not-run'
    ? 'hardware suite not run (set VALLOX_HOST and re-run npm run test:report from a machine on the unit\'s LAN)'
    : hardwareState === 'failed'
      ? 'hardware suite ran but had failures — see output above, coverage not counted'
      : `${hardwareCount}/${allMethods.length} methods actually hit by a passing hardware run`

const html = `<!doctype html>
<html lang="en">
<head>
    <title>vallox.js — test coverage</title>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="lcov-report/prettify.css" />
    <link rel="stylesheet" href="lcov-report/base.css" />
    <link rel="shortcut icon" type="image/x-icon" href="lcov-report/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style type="text/css">
        .coverage-summary .sorter { background-image: url(lcov-report/sort-arrow-sprite.png); }
        .section-gap { margin-top: 2.5em; }
    </style>
</head>
<body>
<div class="wrapper">
    ${istanbulHeader}
    <div class="pad1">
        ${istanbulSummaryTable}
        <p class="quiet"><a href="lcov-report/index.html">→ Browse the full interactive report</a> (click into any file for line-by-line hit/miss highlighting)</p>
    </div>

    <div class="pad1 section-gap">
        <h1>Method coverage: mocked vs. real hardware</h1>
        <p class="quiet">
            Real per-function execution hits from Istanbul's <code>coverage-final.json</code>.
            A method only counts as covered if it was actually invoked during a <strong>passing</strong> run of that suite.
        </p>
        <p class="strong">
            ${mockCount}/${allMethods.length} methods actually hit by the mocked suite (<code>npm test</code>, always CI-safe);
            ${hardwareSummary}.
        </p>
        <table class="coverage-summary">
<thead>
<tr>
   <th class="file">Method</th>
   <th class="pct">Mocked</th>
   <th class="pct">Hardware</th>
</tr>
</thead>
<tbody>${methodRows.join('\n')}
</tbody>
</table>
    </div>

    <div class="pad1 section-gap">
        <h1>Notes</h1>
        <ul class="quiet">
${NOTES.map(([file, note]) => `            <li><code>${escapeHtml(file)}</code>: ${escapeHtml(note)}</li>`).join('\n')}
        </ul>
    </div>

    <div class="push"></div>
</div>
<div class="footer quiet pad2 space-top1 center small">
    Generated by <code>npm run test:report</code> on ${new Date().toISOString().slice(0, 10)} —
    file coverage table and styling from
    <a href="https://istanbul.js.org/" target="_blank" rel="noopener noreferrer">istanbul</a>.
</div>
</body>
</html>
`

writeFileSync(join(ROOT, 'coverage', 'test-report.html'), html)
console.log(`\nWrote coverage/test-report.html (mocked: ${mockCount}/${allMethods.length}; hardware: ${hardwareSummary})`)
