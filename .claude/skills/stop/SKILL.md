---
description: Stop all Boca Schedule dev services (Supabase, Julia optimizer, backend, frontend)
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

## 2. Kill Julia optimizer

```bash
pkill -f "julia server.jl" 2>/dev/null; true
```

Or by port:

```bash
lsof -ti:3002 | xargs kill -9 2>/dev/null; true
```

## 3. Stop Supabase

Run from the project root:

```bash
cd "/Users/asb/Desktop/Desktop-ASBMacBookPro/Projects/Boca Schedule"
npx supabase stop
```

Data is preserved in Docker volumes automatically.

## Verify everything is down

```bash
echo "Port 3001:" && (lsof -ti:3001 > /dev/null 2>&1 && echo "STILL UP" || echo "down")
echo "Port 3002:" && (lsof -ti:3002 > /dev/null 2>&1 && echo "STILL UP" || echo "down")
echo "Port 5173:" && (lsof -ti:5173 > /dev/null 2>&1 && echo "STILL UP" || echo "down")
echo "Docker:" && docker ps --filter "name=supabase" --format "{{.Names}}" 2>/dev/null | grep -c . || echo "0 containers"
```
