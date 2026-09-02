# HAYK — NUMU Creative Director

HAYK is a visible, gated cinematic-production studio. It turns a locked creative direction and protected references into AI evidence, canonical identities, shot boundary frames, independent motion clips, a synchronized final test video, multimodal QC, and a downloadable result.

Production: https://numu-studio.wwqpjb.chatgpt.site

## Technical handoff

The complete architecture, production state machine, provider contracts, recovery rules, security model, deployment procedure, test checklist, and known boundaries are documented in:

- [HAYK Technical Handoff — 2026-09-01](docs/HAYK_TECHNICAL_HANDOFF_2026-09-01.md)

## Local verification

Requirements:

- Node.js `>=22.13.0`
- Linux with `flock`, `curl`, and GNU `timeout`

Commands:

```bash
npm run install:ci
npm test
npm run lint
```

`npm test` performs the bounded verified Vinext build and runs the regression suite.

## Hosting

The application is managed by ChatGPT Sites and runs on Vinext/Cloudflare Workers with:

- D1 binding `DB` for project and production state;
- R2 binding `BUCKET` for private reference and generated media;
- `NUMU_SESSION_SECRET` for AES-GCM session encryption and expiring provider/worker media grants.

Bindings are declared in `.openai/hosting.json`. This project intentionally does not use `wrangler.jsonc`.

Never commit API keys, session cookies, worker secrets, signed grant URLs, or generated private media URLs.
// redeploy
