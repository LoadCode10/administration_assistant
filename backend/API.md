# Assistant Administratif Marocain — Backend

A chatbot that helps people find and complete Moroccan administrative
procedures, plus an admin panel to manage the procedure database.

Full interactive docs (every field, try-it-out): **http://localhost:8000/docs**
This page is just a quick, plain-language map of the API.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Fill in `.env`: your Postgres credentials and a `GEMINI_API_KEY`
(https://aistudio.google.com/apikey). Then:

```bash
psql -U <DB_USER> -d <DB_NAME> -c "CREATE EXTENSION IF NOT EXISTS vector;"
python create_tables.py     # creates the database tables
python create_admin.py      # sets up your admin account (asks once, skips if one exists)
uvicorn main:app --reload
```

Runs at `http://localhost:8000`.

**If `pip install` fails with "No space left on device":** it tried to
download a huge GPU version of `torch`. Run this first, then retry:
```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

**If `create_tables.py` fails with `type "vector" does not exist`:** the
`CREATE EXTENSION` command above hasn't been run yet, or pgvector isn't
installed on your Postgres server.

## Auth

Session-based, via an `httpOnly` cookie — not a token you handle yourself.
Register → login (the server sets the cookie automatically) → every
following request just needs that cookie attached, which the browser does
for you. Two roles: `user` (anyone can register as one) and `admin` (only
created via `python create_admin.py`, never through the API).

If you're calling the API from a browser app on a different port/domain than
the backend (e.g. the frontend on `:5173` calling `:8000`), fetch/axios calls
need `credentials: "include"` (axios: `withCredentials: true`) or the cookie
won't be sent — already set up in this project's `frontend/`.

## Endpoints

**Auth**
| Method & path | Who | What it does |
|---|---|---|
| `POST /auth/register` | anyone | Create an account (always role `user`) |
| `POST /auth/login` | anyone | Log in — sets the session cookie |
| `POST /auth/logout` | anyone | Log out — deletes the session, clears the cookie |
| `GET /auth/me` | logged in | Your account info |

**Procedures**
| Method & path | Who | What it does |
|---|---|---|
| `GET /procedures` | anyone | List/search procedures (`?proc_title=`, `?proc_admin_name=`) |
| `GET /procedures/{id}` | anyone | One procedure's full detail |

**Chat**
| Method & path | Who | What it does |
|---|---|---|
| `POST /conversations` | logged in | Start a new conversation |
| `GET /conversations` | logged in | List your conversations |
| `GET /conversations/{id}` | logged in | A conversation and all its messages |
| `DELETE /conversations/{id}` | logged in | Delete a conversation |
| `POST /conversations/{id}/messages` | logged in | Ask a question |
| `PATCH /conversations/{id}/questions/{qid}` | logged in | Edit a question (re-answers it) |
| `DELETE /conversations/{id}/questions/{qid}` | logged in | Delete one message |

Asking a question returns either a confident match (`type: "answer"` +
the matched `procedure`) or, if nothing clearly matches, up to 3 suggestions
to choose from (`type: "suggestions"`).

**Progress tracking**
| Method & path | Who | What it does |
|---|---|---|
| `POST /procedures/{id}/start` | logged in | Start tracking a procedure (creates a checklist) |
| `GET /me/procedures` | logged in | Your procedure history |
| `GET /me/procedures/{id}` | logged in | One run's checklist + progress |
| `PATCH /me/procedures/{id}/etapes/{etape_id}` | logged in | Check/uncheck a step |
| `PATCH /me/procedures/{id}/pieces/{piece_id}` | logged in | Check/uncheck a required document |

Progress is one combined percentage across steps + documents; a run is marked
done once everything is checked.

**Admin**
| Method & path | Who | What it does |
|---|---|---|
| `POST /admin/procedures` | admin | Add a procedure by hand |
| `PATCH /admin/procedures/{id}` | admin | Edit a procedure |
| `DELETE /admin/procedures/{id}` | admin | Delete a procedure |
| `POST /admin/extract` | admin | Upload file(s) (`.txt`/`.json`/`.docx`/`.pdf`) — AI extracts procedures from them |
| `GET /admin/extract` | admin | List extraction batches waiting for review |
| `GET /admin/extract/{id}` | admin | View one batch |
| `PATCH /admin/extract/{id}` | admin | Correct the extracted data |
| `POST /admin/extract/{id}/validate` | admin | Approve it — adds it to the real database |
| `POST /admin/extract/{id}/reject` | admin | Discard it |
| `GET /admin/stats` | admin | Dashboard KPIs — see below |

Nothing an admin uploads reaches the real database until they explicitly
validate it.

`GET /admin/stats` returns a flat snapshot for an admin dashboard:
content state (`total_procedures`, `total_administrations`,
`procedures_missing_embedding` — should always be 0), account state
(`total_users`, `total_admins`), the review queue
(`pending_extraction_batches`), the last 7 days of chat activity
(`questions_last_7_days`, `direct_answers_last_7_days`,
`suggestions_last_7_days`), and engagement (`procedures_in_progress`,
`procedures_completed`, `top_procedure` — the most-started procedure and
how many times).

## Try it with curl

Session auth means curl needs a cookie jar instead of a captured token:
`-c cookies.txt` saves the `Set-Cookie` from login, `-b cookies.txt` sends it
back on later requests.

Register and log in as a normal user:
```bash
curl -X POST http://localhost:8000/auth/register -H "Content-Type: application/json" \
  -d '{"nom_user":"Test","prenom_user":"User","email_user":"user@test.com","password":"test1234"}'

curl -c cookies.txt -X POST http://localhost:8000/auth/login -H "Content-Type: application/json" \
  -d '{"email_user":"user@test.com","password":"test1234"}'
```

Browse procedures (no login needed):
```bash
curl http://localhost:8000/procedures
```

Start a conversation and ask a question:
```bash
curl -b cookies.txt -X POST http://localhost:8000/conversations
# copy id_conversation from the response, then:

curl -b cookies.txt -X POST http://localhost:8000/conversations/<id_conversation>/messages \
  -H "Content-Type: application/json" \
  -d '{"question_content": "Comment renouveler ma carte d'\''identité ?"}'
```

Start tracking a procedure and check off a step (grab `id_procedure` from the
`/procedures` list above, then `id_user_procedure`/`id_etape` from this
command's response):
```bash
curl -b cookies.txt -X POST http://localhost:8000/procedures/<id_procedure>/start

curl -b cookies.txt -X PATCH http://localhost:8000/me/procedures/<id_user_procedure>/etapes/<id_etape> \
  -H "Content-Type: application/json" -d '{"is_done": true}'
```

Log out (invalidates the session immediately, unlike a JWT that would stay
valid until it naturally expired):
```bash
curl -b cookies.txt -c cookies.txt -X POST http://localhost:8000/auth/logout
```

Admin — log in with your admin account (separate cookie jar so it doesn't
clobber the user session above), then add a procedure by hand:
```bash
curl -c admin_cookies.txt -X POST http://localhost:8000/auth/login -H "Content-Type: application/json" \
  -d '{"email_user":"admin@example.com","password":"your-admin-password"}'

curl -b admin_cookies.txt -X POST http://localhost:8000/admin/procedures \
  -H "Content-Type: application/json" \
  -d '{
    "titre_proc": "Certificat négatif",
    "nom_administration": "OMPIC",
    "frais_proc": "230 DH",
    "pieces": ["CIN"],
    "etapes": ["Se rendre sur le site OMPIC", "Payer les frais"]
  }'
```

Admin — upload a file for AI extraction:
```bash
curl -b admin_cookies.txt -X POST http://localhost:8000/admin/extract \
  -F "files=@mon_document.pdf"
```
This returns an `id_staging` — use `GET /admin/extract/<id_staging>` to see
what it extracted, then `POST /admin/extract/<id_staging>/validate` to
approve it.

## Good to know

- Every response is JSON. Errors look like `{ "detail": "message" }`.
- A `403` means you're logged in but it's not yours (e.g. someone else's
  conversation or procedure run); `404` means it doesn't exist.
- Editing a question re-runs the search and replaces its old answer.
- The confidence threshold for "clear match vs. suggestions" lives in
  `retrieval.py` (`CONFIDENCE_DISTANCE_THRESHOLD`) — worth tuning once real
  data is loaded.
- Changing the database schema means re-running `create_tables.py`, which
  wipes all data (there's no migration tool yet).
