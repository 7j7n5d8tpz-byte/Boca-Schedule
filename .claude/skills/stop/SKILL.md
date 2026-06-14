---
description: Stop all Boca Schedule dev services (Supabase, backend, frontend)
---

Stop all services for Boca Schedule.

## 1. Kill Node servers (backend + frontend)

```bash
pkill -f "tsx watch" 2>/dev/null; pkill -f "vite" 2>/dev/null; true
```

Or by port if needed:

```bash
lsof -ti:3001 | xargs kill -9 2>/dev/null; true
lsof -ti:5173 | xargs kill -9 2>/dev/null; true
```

## 2. Stop Supabase

Run from the project root:

```bash
cd "/Users/asb/Desktop/Desktop-ASBMacBookPro/Projects/Boca Schedule"
npx supabase stop
```

Data is preserved in Docker volumes automatically.

## Verify everything is down

```bash
echo "Port 3001:" && (lsof -ti:3001 > /dev/null 2>&1 && echo "STILL UP" || echo "down")
echo "Port 5173:" && (lsof -ti:5173 > /dev/null 2>&1 && echo "STILL UP" || echo "down")
echo "Docker:" && docker ps --filter "name=supabase" --format "{{.Names}}" 2>/dev/null | grep -c . || echo "0 containers"
```
