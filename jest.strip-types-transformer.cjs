'use strict'

/**
 * Minimal Jest transformer that strips TypeScript syntax via Node's own
 * native `node:module.stripTypeScriptTypes` (erasable-syntax mode) instead
 * of ts-jest — ts-jest's peer range caps at `typescript <7`, and TypeScript 7
 * ("tsgo") is a from-scratch Go rewrite that doesn't expose the in-process JS
 * Compiler API ts-jest relies on. This project already enforces
 * `erasableSyntaxOnly` in tsconfig.json, so no TS feature here needs real
 * type-directed codegen (enums, namespaces, etc.) — plain syntax stripping is
 * sufficient. Type-checking itself still happens via `npm run build` (tsc);
 * this transform intentionally does not type-check.
 */
const { stripTypeScriptTypes } = require('node:module')

module.exports = {
  process(sourceText, sourcePath) {
    const code = stripTypeScriptTypes(sourceText, { mode: 'strip', sourceUrl: sourcePath })
    return { code }
  },
}
