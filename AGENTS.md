# Agent Instructions — numu-studio

## Quick Commands

```bash
npm run dev      # localhost:3000
npm run build    # production build
npm run lint     # eslint check
```

No test script is configured. No `npm test` exists.

## Stack

- **Next.js 16.3.4** — has breaking changes from older versions; check `node_modules/next/dist/docs/` before writing code
- **React 19.2.8** with App Router (`src/app/`)
- **Tailwind CSS 4** via `@tailwindcss/postcss`
- **TypeScript 5** — strict mode enabled

## Architecture

```
src/
  app/
    page.tsx            # Dashboard (project library)
    layout.tsx          # Root layout with Sidebar
    chat/page.tsx       # Chat interface with HAYK
    settings/page.tsx   # API key configuration
    references/page.tsx # Reference library
    api/
      chat/route.ts     # OpenRouter chat completions proxy
      images/route.ts   # OpenRouter image generation proxy
      videos/route.ts   # OpenRouter video generation proxy
  components/
    Sidebar.tsx         # Navigation sidebar
    VideoPlayer.tsx     # Video playback component
    AudioEditor.tsx     # Audio track editing component
```

## Key Facts

- **No database** — all state stored in browser localStorage
- **API proxy** — routes call OpenRouter; API key passed from localStorage to server routes
- **Deployed on Vercel** — auto-deploys from `main` branch
- **Path alias**: `@/*` maps to `./src/*`

## Gotchas

- Next.js 16 has breaking changes from earlier versions. The `AGENTS.md` auto-generated block warns about this — do not remove it.
- API routes run server-side; they receive the OpenRouter key via POST body, not environment variables.
- localStorage is per-origin — data in `localhost` won't appear on `*.vercel.app` and vice versa.
- The sidebar loads projects from localStorage on mount; clearing browser data removes all projects.
