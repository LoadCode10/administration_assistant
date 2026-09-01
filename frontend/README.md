# Assistant Administratif Marocain — Frontend

React app (Vite + Tailwind CSS) for the chat assistant. Talks to the backend
described in `../backend/API.md`.

## Setup

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173`. Set the backend's address in `.env`:

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | The backend's URL (default `http://localhost:8000`) |

Other scripts: `npm run build` (production build), `npm run preview` (serve
that build), `npm run lint`.

## Stack

Vite + React (plain JavaScript), Tailwind CSS, `react-router-dom`, `axios`.

## Pages

| Route | Who can see it | What's there |
|---|---|---|
| `/` | logged-in users (redirects to login otherwise; admins get sent to `/admin/procedures`) | The chat |
| `/login`, `/register` | anyone | Sign in / create an account |
| `/history` | logged in | Your list of tracked procedures |
| `/history/:id` | logged in, your own only | Checklist + progress bar for one procedure |
| `/admin/procedures` | admin | Manage procedures (add, edit, delete) |
| `/admin/extract` | admin | Upload files for AI extraction, see pending batches |
| `/admin/extract/:id` | admin | Review, correct, and approve/reject an extraction |

## How it fits together

- **Login** is session-based: the backend sets an `httpOnly` cookie the
  browser sends automatically on every request — there's no token for the
  app's own JS to read or store. If a request comes back "unauthorized," the
  app logs you out automatically.
- **Chat** is organized into conversations (start a new one, revisit old
  ones, edit or delete a message, delete a whole conversation). Asking a
  question either shows the matching procedure directly, or a few suggestions
  to pick from if nothing's clear.
- **Tracking a procedure** ("Commencer la procédure") creates a checklist —
  its required documents and steps — with a progress bar that fills in as you
  check things off.
- **Admin** can add procedures by hand, or upload a document and let AI pull
  the structured data out of it — nothing gets added to the real database
  until an admin reviews it and clicks "Valider."
- Every action that changes or deletes something shows a confirmation dialog
  first.

## Folder layout, briefly

```
src/
  api/          one small file per backend area (auth, procedures, conversations, progress, admin)
  context/      AuthContext — who's logged in
  routes/       page guards (must be logged in / must be admin)
  components/   chat/, procedures/, progress/, admin/, layout/, common/
  pages/        one file per route, mostly just wiring components together
```

## Known limitations

- No automated tests yet.
- No pagination (fine at the current scale; would need revisiting for a large
  procedure catalog).
