# GGC Resource Planner

A professional, deployable construction resource planning website for GitHub and Vercel.

## What is included

- Vite + React app
- Tailwind styling
- GGC-style green branding
- Superintendent Gantt chart
- Crew Gantt chart
- Project Gantt chart
- Conflict watch for double-booked crews/superintendents
- Project status filter
- Search filters
- Drag-and-drop CSV upload for project schedules
- Vercel-ready configuration

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown in the terminal.

## Build locally

```bash
npm run build
npm run preview
```

## Deploy to GitHub

```bash
git init
git add .
git commit -m "Initial resource planner"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git push -u origin main
```

## Deploy to Vercel

1. Go to Vercel.
2. Click **Add New > Project**.
3. Import your GitHub repository.
4. Vercel should detect **Vite** automatically.
5. Build command: `npm run build`
6. Output directory: `dist`
7. Click **Deploy**.

## CSV Upload Format

Use the included file:

```text
sample-project-import.csv
```

Required columns:

```text
id,name,pm,location,startWeek,durationWeeks,phase,status,crew,superintendent
```

Notes:

- `startWeek` is a zero-based index.
  - `0` = first week shown
  - `1` = second week shown
- `durationWeeks` is how many weeks the project lasts.
- `status` must be one of:
  - `Planned`
  - `Confirmed`
  - `At Risk`
- `crew` must match one of the configured crews.
- `superintendent` must match one of the configured superintendents.

## Where to edit company data

Edit:

```text
src/data/sampleData.js
```

You can update:

- Projects
- Crews
- Superintendents
- Timeline weeks

## Next recommended upgrade

Connect this to a database such as Supabase, Firebase, or a secured company SharePoint/Excel workflow so assignments persist after refresh.
