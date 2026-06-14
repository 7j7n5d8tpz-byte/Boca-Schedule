---
description: Start all Boca Schedule dev services (Supabase, backend, frontend)
---

Start all services for Boca Schedule in this order:

## 1. Supabase

Run from the project root (the directory containing `supabase/`):

```bash
cd "/Users/asb/Desktop/Desktop-ASBMacBookPro/Projects/Boca Schedule"
npx supabase start
```

This starts 12 Docker containers. It prints a summary table when ready. Takes ~30 seconds on a warm cache.

The squad optimizer runs in-process in the backend (HiGHS-WASM) — there is no separate optimizer service to start.

## 2. Backend + Frontend

```bash
cd "/Users/asb/Desktop/Desktop-ASBMacBookPro/Projects/Boca Schedule"
npm run dev > /tmp/nodedev.log 2>&1 &
```

- Backend (Express) → port 3001
- Frontend (Vite) → port 5173

Wait for both:

```bash
for i in {1..30}; do
  curl -sf http://localhost:3001/api/matches/upcoming 2>/dev/null | grep -q '"success"' && \
  curl -sf -o /dev/null http://localhost:5173 && break
  sleep 1
done
```

## Verify all services

```bash
echo "Supabase:" && curl -sf http://127.0.0.1:54321/rest/v1/ -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqd7uqOlN1qsb0Y2_WJrUXXFLcNQ-kI7o" -o /dev/null -w "%{http_code}\n"
echo "Backend:" && curl -sf http://localhost:3001/api/matches/upcoming -o /dev/null -w "%{http_code}\n"
echo "Frontend:" && curl -sf http://localhost:5173 -o /dev/null -w "%{http_code}\n"
```

## Ports summary

| Service | Port |
|---|---|
| Supabase API | 54321 |
| Supabase DB | 54322 |
| Supabase Studio | 54323 |
| Backend API | 3001 |
| Frontend (Vite) | 5173 |

App opens at **http://localhost:5173**
