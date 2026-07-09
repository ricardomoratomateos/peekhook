// Cross-compile the peekgrok binary for every supported target.
// Run with: bun run scripts/build-all.js
//
// Each output is a standalone binary; it still discovers the web dist at
// runtime (see findWebDist in bin/peekgrok.js), so ship apps/web/dist
// alongside it or pass --web-dist / PEEKHOOK_WEB_DIST.
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const ENTRY = './bin/peekgrok.js'
const OUT_DIR = 'dist'

const TARGETS = [
  { target: 'bun-darwin-arm64',  out: 'peekgrok-darwin-arm64' },
  { target: 'bun-darwin-x64',    out: 'peekgrok-darwin-x64' },
  { target: 'bun-linux-x64',     out: 'peekgrok-linux-x64' },
  { target: 'bun-linux-arm64',   out: 'peekgrok-linux-arm64' },
  { target: 'bun-windows-x64',   out: 'peekgrok-windows-x64.exe' },
]

mkdirSync(OUT_DIR, { recursive: true })

let failed = 0
for (const { target, out } of TARGETS) {
  const outfile = `${OUT_DIR}/${out}`
  const cmd = `bun build --compile --minify --target=${target} ${ENTRY} --outfile=${outfile}`
  process.stdout.write(`\n→ ${target}\n  ${cmd}\n`)
  try {
    execSync(cmd, { stdio: 'inherit' })
  } catch (err) {
    console.error(`  ✗ failed to build ${target}: ${err.message}`)
    failed++
  }
}

if (failed) {
  console.error(`\n${failed}/${TARGETS.length} target(s) failed.`)
  process.exit(1)
}
console.log(`\n✓ built ${TARGETS.length} targets into ${OUT_DIR}/`)
