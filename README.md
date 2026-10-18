# Test runner for Testiny

A lightweight mobile web app (PWA) to execute manual test runs from [Testiny](https://www.testiny.io) on a phone.

Testers can open an existing test run, read each test case, set its result, add a comment and attach photos taken with the phone camera. Creating or managing test cases, plans and runs stays in the Testiny web app.

- No backend, no build step, no dependencies: plain HTML, CSS and JavaScript
- Each tester uses their own Testiny API key, stored only in their browser
- Installable on the home screen (Android and iOS)
- Available in English, French, German, Spanish and Dutch

## Project structure

| File | Purpose |
|---|---|
| `index.html` | App shell |
| `app.js` | App logic and Testiny API calls |
| `i18n.js` | Translations |
| `styles.css` | Styles (light and dark mode) |
| `manifest.json`, `sw.js`, `icons/` | PWA installation |
| `proxy/worker.js` | Optional CORS proxy (not part of the deployed site) |

## Deployment on GitHub Pages

1. Push the content of this folder to the **root** of a GitHub repository. `index.html` must be at the root, not in a subfolder. On a free GitHub account, the repository must be public.
2. In the repository, open **Settings → Pages**.
3. Under *Build and deployment*, set *Source* to **Deploy from a branch**, then select `main` and `/ (root)`, and click **Save**.
4. After a minute or two, the URL appears at the top of the Pages settings: `https://YOUR-USERNAME.github.io/REPO-NAME/`. Progress is visible in the **Actions** tab.

Every push to `main` redeploys the site automatically. On the phone, close and reopen the app to pick up a new version.

The app contains no secrets: API keys never leave the testers’ devices.

## Usage

### Installation

Open the GitHub Pages URL on the phone, then:

- **iOS (Safari):** *Share → Add to Home Screen*
- **Android (Chrome):** *⋮ → Install app*

### First launch

1. Create an API key in Testiny (account settings) with at least **Editor** permissions. Lower permissions cannot upload attachments.
2. In the app, enter the API key and tap **Load projects**.
3. Select the project and confirm.

The settings stay saved on the device. They can be changed at any time with the gear icon.

### Executing tests

1. Pick a test run. Closed runs are hidden unless *Show closed runs* is checked.
2. The run view shows the progress and the status of each test case. Use the status chips (*Not run*, *Failed*…) and the *Assigned to* selector to narrow the list; both filters are remembered on the device. Tap a test case to open it.
3. Read the preconditions, steps and expected result.
4. Optionally write a comment, and add attachments: **Take photo** opens the camera directly, **Add file** picks existing photos or PDF, text, log and CSV files. Photos are resized to 1600 px max before upload; other files are uploaded as-is.
5. Select a result: Passed, Failed, Blocked or Skipped.
6. Tap **Save** to return to the run, or **Save and next** to go straight to the next test case in the filtered list.

### Working with several testers

The app does not update live. Results saved by others appear when a screen is opened, or with the **refresh** button (↻) in the top bar of the runs list and run views.

Before saving a result, the app checks whether someone else changed the status of that test case since you opened it. If so, it asks before overwriting. If you cancel, nothing is saved: the current status is shown, and your comment and attachments are kept so you can save again.

### Language

Tap the language pill in the top bar (EN, FR, DE, ES, NL). The choice is saved on the device. On first launch, the app uses the phone’s language when available, English otherwise.

To add a language, add a block to `DICT` and an entry to `LANGS` in `i18n.js`. Missing keys fall back to English.

## CORS restrictions

The app calls the Testiny API (`https://app.testiny.io/api/v1`) directly from the browser. If the API does not allow cross-origin requests, the browser blocks them and the app shows *“Couldn’t reach Testiny”* when loading projects.

### Diagnosis

Open the app URL in a desktop browser, open the developer tools (F12, *Console* tab) and tap **Load projects**:

- **“blocked by CORS policy”**: the API rejects browser requests. Set up the proxy below.
- **“ERR_NAME_NOT_RESOLVED”** or another connection error: check the *API address* in the settings and your network (company firewall).
- **401 or 403:** the API key is invalid or lacks permissions.

### Solution: Cloudflare Worker proxy

A small proxy forwards the requests to Testiny and adds the CORS headers. It stores nothing: each request still carries the tester’s own API key. The Cloudflare free plan is enough.

1. Create a free account at [cloudflare.com](https://www.cloudflare.com).
2. Go to **Workers & Pages → Create → Create Worker**, keep the “Hello World” template and click **Deploy**.
3. Click **Edit code** and replace the whole content with `proxy/worker.js`.
4. On the second line, set `ALLOWED_ORIGIN` to your GitHub Pages origin, without the repository path and without a trailing slash:
   ```js
   const ALLOWED_ORIGIN = "https://YOUR-USERNAME.github.io";
   ```
5. Click **Deploy** and copy the worker URL, e.g. `https://testiny-proxy.YOUR-SUBDOMAIN.workers.dev`.
6. In the app settings, paste this URL in **API address** and tap **Load projects**.

No change to the app code or redeployment is needed. Each tester enters the proxy URL once in their settings.

## Testiny API calls

| Action | Call |
|---|---|
| List projects | `GET /project` |
| List test runs | `POST /testrun/find` |
| Test cases and results in a run | `POST /testcase/find` with a `testcase ↔ testrun` map |
| Set a result | `POST /testrun/mapping/bulk/testcase:testrun?op=update` |
| Add a comment | `POST /comment/bulk`, then `POST /comment/mapping/bulk/comment:testcase:testrun?op=add` |
| Upload a photo | `POST /testrun/upload-attachment/:runId/:caseId` (raw JPEG body) |

See the [Testiny REST API documentation](https://www.testiny.io/docs/api-quickstart/) for details.

## Troubleshooting

- **Steps are not displayed:** open the test case and expand *Raw data (diagnostics)* at the bottom to see which field holds the steps.
- **Closed runs still appear in the list:** closed runs are detected with the `is_closed` or `closed_at` fields. Check the field name in a `/testrun/find` response.
- **The app does not update after a push:** close and reopen it. If needed, bump `CACHE` in `sw.js` to force a refresh.

## License and disclaimer

This project is released under the [MIT License](LICENSE). You are free to fork it and adapt it to your needs.

The software is provided “as is”, without warranty of any kind. S.A. JAC N.V. does not guarantee that it works correctly or fits any particular purpose, and may change its behavior or limit or discontinue the availability of this repository and its hosted version at any time, without notice.

This project is not affiliated with or endorsed by Testiny.

This project was developed with the assistance of Claude, an AI model by Anthropic, and tested by S.A. JAC N.V. on its Testiny projects.
