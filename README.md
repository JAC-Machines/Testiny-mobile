# Test runner for Testiny

Minimal mobile PWA to execute existing Testiny test runs: set results, add comments, attach photos.
No build step, no dependencies. Each tester uses their own API key, stored only in their browser.

## Deploy on GitHub Pages

1. Push the content of this folder (except `proxy/`, optional) to the root of a public repo.
2. Repo *Settings → Pages → Deploy from branch*, select `main` and `/ (root)`.
3. Open `https://YOUR-USERNAME.github.io/REPO-NAME/` on the phone.
4. Install it: *Share → Add to Home Screen* (iOS) or *Install app* (Android Chrome).

## First launch

1. Enter a Testiny API key (at least **Editor** permissions).
2. Tap *Load projects*, pick the project, save.

If loading projects fails with “Couldn’t reach Testiny”, the API is blocking browser requests (CORS). Use the proxy below.

## CORS fallback: Cloudflare Worker proxy

1. Create a free Cloudflare account, then *Workers & Pages → Create → Hello World*.
2. Replace the code with `proxy/worker.js` and set `ALLOWED_ORIGIN` to your Pages origin (no path).
3. Deploy, then in the app settings set *API address* to the worker URL, e.g. `https://testiny-proxy.YOUR-SUBDOMAIN.workers.dev`.

The proxy stores nothing; it forwards each request with the tester’s own key.

## Testiny API calls used

| Action | Call |
|---|---|
| List projects | `GET /project` |
| List runs | `POST /testrun/find` |
| Cases and results in a run | `POST /testcase/find` with `map: testcase ↔ testrun` |
| Set result | `POST /testrun/mapping/bulk/testcase:testrun?op=update` |
| Add comment | `POST /comment/bulk` then `POST /comment/mapping/bulk/comment:testcase:testrun?op=add` |
| Upload photo | `POST /testrun/upload-attachment/:runId/:caseId` (raw JPEG body) |

## Assumptions to verify on first test

- Closed runs are detected via `is_closed` or `closed_at`. If closed runs still show, check the field name in a `/testrun/find` response.
- Project names are read from `name` (fallback `title`).
- Rich text in steps is flattened to plain text. Markdown is shown raw.
- Photos are downscaled to 1600 px max and re-encoded as JPEG (quality 0.8).

## Updating

The service worker is network-first, so a reload picks up new versions. Bump `CACHE` in `sw.js` when changing the cached file list.
