# AI Contest Board

Static domestic and overseas AI contest pages for GitHub Pages.

- Production: <https://junyeo217.github.io/ai-contest-board/>
- Overseas: <https://junyeo217.github.io/ai-contest-board/overseas/>
- Author: 주녀 (`@junyeo.ai`), <junyeo.ai@gmail.com>

## Source of truth

Do not hand-edit contest records in generated HTML. Record data lives in:

- `data/contests.json`
- `data/overseas-contests.json`

`template.json` contains page metadata, the reviewed music-video dual-category whitelist, and three manually verified guideline summaries. `build.mjs` contains the zero-dependency renderer and progressive-enhancement client.

## Regenerate

Requires Node.js 20 or newer. No package install is needed.

```sh
node build.mjs
```

The build uses the current Asia/Seoul day (override with `BOARD_DATE=YYYY-MM-DD` for reproducible tests) and writes:

- `index.html`
- `overseas/index.html`
- `sitemap.xml`
- `llms.txt`

Run the builder after an intentional JSON or template update, then review the diff. Sitemap `lastmod` values come from each JSON file's `generated_at`, not from the build clock.

## Runtime behavior

Each page includes a crawlable initial list built for the build-time Asia/Seoul date. JavaScript fetches the same JSON on load to refresh filters and statuses. If that fetch fails, the server-rendered list remains visible and a warning is shown.

Status rules:

- `접수중`: the start date has arrived and the submission end has not passed.
- `발표예정`: submission ended, but an actual result publication has not been confirmed.
- `발표완료`: requires `results_confirmed: true` and a valid `results_published_at`; it remains visible for 7 days, then is excluded.
- Future-starting records are excluded until their start date.

Stable internal contest anchors are derived deterministically from `title + submission_end` without changing the source JSON.

## Editorial policy

The board is advisory. Official or organizer-controlled links are labeled `공식 원문`; other links are labeled `참고 원문`. Never infer missing dates, fees, eligibility, rights, or submission requirements. Entrants must verify the linked organizer page before submitting.

`llms.txt` is a nonstandard advisory description only. This repository intentionally does not include a project-level `robots.txt`, because GitHub Pages hosts it below the domain root and it cannot control the entire host.

## Automated publishing and backup

`.github/workflows/pages.yml` regenerates the public HTML on each main-branch update and daily at 00:05 Asia/Seoul (scheduled Actions may be delayed). GitHub Pages uses the GitHub Actions source, not branch publishing. Only public HTML, data, sitemap and llms.txt are deployed; source templates and tests are excluded.

Original pre-redesign backup: `backup/pre-redesign-2026-09-08`, commit `ee3fc8b9389272edd1b1568ef6ddb5ba3353a1c2`. To roll back, restore the branch contents and reset Pages to main / root branch publishing. Keep the backup branch intact.

Host robots.txt is separately managed at https://junyeo217.github.io/robots.txt and currently allows crawling. Submit https://junyeo217.github.io/ai-contest-board/sitemap.xml through the verified Search Console property when available. Search Console submission and search/AI inclusion are not guaranteed by deployment.
