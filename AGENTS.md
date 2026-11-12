# AGENTS.md

## Commands
- Use a Node version that provides `node:sqlite` (22.5+; this checkout has Node 26). `package.json` `engines >=18` and CI's Node 20 do not reflect that requirement.
- `npm start` / `npm run dev`; the app listens on `http://localhost:3000`. There is no build step or typecheck.
- Local default is a real SQLite DB at `data/wanda.sqlite3`; no `.env` is needed. Startup aborts if the DB cannot initialize. `DATABASE_URL` switches to PostgreSQL, and production requires `SALT_SECRET`.
- Standard verification: `npm run lint && npm test`. CI runs lint, then tests on SQLite, then tests on PostgreSQL.
- Single file: `node --test test/logic.test.js`. Single test: `node --test --test-name-pattern "score HOT" test/logic.test.js`.
- PostgreSQL tests: `TEST_DATABASE_URL=postgresql://.../wanda_test npm test`. The DB name must contain `test`, `ci_`, `tmp`, `temp`, or `throwaway`. The suite TRUNCATEs and deliberately refuses `DATABASE_URL`, even if it points locally.
- `npm run icons` regenerates PNGs from the SVGs.
- `npm run lint` uses an explicit file list and misses `backend/sql.js` and `backend/utils/tags.js`; run `node --check <file>` after editing those.

## Architecture and data
- The frontend is vanilla HTML/CSS/JS with no bundler. Express serves `frontend/` statically and handles SPA fallback, explicitly excluding `/api`.
- One app supports SQLite and PostgreSQL. Write route SQL with `$n` placeholders; `backend/db.js` translates them for SQLite. Keep dialect-specific SQL in `backend/sql.js`.
- Use `parseJsonColumn`, `toIso`, and `nowIso` from `backend/db.js`. Do not use `CURRENT_DATE`/`CURRENT_TIMESTAMP` for business time: days are Africa/Douala dates computed in JS, and millisecond timestamps determine counter ranks.
- Schema changes are append-only: add an idempotent migration in `backend/migrations.js` using `{{TOKEN}}` types; never edit a migration already applied.
- Tags are normalized in `backend/utils/tags.js`. Explicit tags and text hashtags are merged, capped at 5. `posts.categories` is compatibility data derived as `#Display`.
- Post creation writes the post and tag links without a transaction; tag failures are logged and do not fail the post.
- Integration test reset (`TABLES`) omits `tags`, `post_tags`, and `tag_aliases`; add them when testing tag behavior.

## Security and product invariants
- WANDA is anonymous: do not add accounts, profiles, or tracking. Never log raw IPs; use salted fingerprints only.
- Derive client address from `req.ip` with explicit `TRUST_PROXY`. Never trust `X-Forwarded-For` directly.
- Every write route must be rate-limited and fail closed with `503` on DB errors. Never return success/`201` when the write failed.
- Reports are deduplicated by IP; three distinct IPs hide a post. The counter counts distinct people per day; reactions toggle per person and type.
- Keep dependencies minimal; do not add a package for a few lines of logic.

## Frontend and PWA
- Current visual system is "Papier Marché" in `frontend/style.css`: default `data-theme="papier"`, 8 themes, and 10 `emoji-anim` modes. README palette/design text predates it; do not restore the old design blindly.
- Emoji reactions and particle effects are intentional. Keep interface chrome SVG-based rather than replacing icons with emoji.
- CSP forbids `unsafe-inline`: no inline `style=` or event handlers. Toggle visibility with `.is-hidden` / `.is-visible`.
- `frontend/sw.js` precaches the shell. Bump `CACHE_VERSION` when changing precached assets, and keep the CI manifest, icon, and precache checks passing.
- Preserve the mobile-first layout, fixed bottom nav, and central publish button.
- README's `ALLOW_MEMORY_FALLBACK` demo mode is stale; no such fallback exists in the current backend.

## Conventions
- Product copy, UI text, and comments are in French; code identifiers are in English.
- Always parameterize SQL. Do not add empty catches; document deliberate ones.
- `README.md` and `CONTRIBUTING.md` contain product rules but may lag the code.
- Never run `git add .` here: the repository root contains untracked user Markdown notes.
