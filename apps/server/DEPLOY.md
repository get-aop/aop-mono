# Deploy AOP Server to Railway + Supabase

The server runs as a **Docker container** on Railway with Postgres from Supabase.

---

## Part 1: Supabase (Database)

### Step 1: Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **New Project**
3. Fill in name, password, region
4. Click **Create new project** (wait ~2 minutes)

### Step 2: Get the connection string

1. **Project Settings** (gear) → **Database**
2. Under **Connection string**, select **URI**
3. For Railway (always-on), use the **Session** pooler or **Direct** connection:
   - **Direct:** `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres`
   - **Session pooler:** `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres` (port 6543)

Save this string — you'll need it for Railway.

### Step 3: Create an API key

After the first deploy, run in Supabase **SQL Editor**:

```sql
INSERT INTO clients (id, api_key, max_concurrent_tasks)
VALUES ('your-client-id', 'your-secret-api-key', 5);
```

Use a strong random string for `api_key` (e.g. `openssl rand -hex 32`).

---

## Part 2: Railway (Server)

### Step 4: Create a Railway project

1. Go to [railway.com](https://railway.com) and sign in
2. Click **New Project**
3. Choose **Deploy from GitHub repo**
4. Select your repository

### Step 5: Configure the service

Railway will create a service. Configure it:

1. **Settings** → **Source**
   - **Root Directory:** repository root
   - A `railway.json` in the repo configures the Dockerfile path automatically

2. **Settings** → **Variables**
   - **AOP_DATABASE_URL:** Your Supabase connection string

3. **Settings** → **Networking**
   - Click **Generate Domain** to get a public URL (e.g. `aop-server-production.up.railway.app`)

### Step 6: Deploy

Push to your connected branch (e.g. `main`). Railway auto-deploys on push.

### Step 7: Verify

```bash
curl https://your-app.up.railway.app/health
```

Expected: `{"ok":true}` or similar.

---

## Configure the Electron app

In AOP Desktop → **Settings**:

- **Server URL:** `https://your-app.up.railway.app`
- **API Key:** The key you created in Supabase

---

## Railway variables reference

| Variable | Required | Description |
|----------|----------|-------------|
| `AOP_DATABASE_URL` | Yes | Supabase Postgres connection string |
| `AOP_LOG_FORMAT` | No | `json` (default) or `pretty` |
| `PORT` | Auto | Railway sets this; Dockerfile uses it |

---

## Monorepo setup

Because the server lives in a monorepo:

1. **Root Directory:** repository root (Settings → Source → Root Directory)
2. **railway.json:** The repo root includes `railway.json` which sets `builder: DOCKERFILE` and `dockerfilePath: apps/server/Dockerfile`

Railway builds from the repository root, so the Dockerfile finds `packages/common`, `packages/infra`, and `apps/server`.

---

## Troubleshooting

### Build fails: "Cannot find module @aop/common"

- Ensure Root Directory is the repository root, not `apps/server`
- The Dockerfile expects to be built with repository root as the build context

### Build fails: "AOP_DATABASE_URL is required"

- Add `AOP_DATABASE_URL` in Railway Variables
- Migrations run at container startup (in `main.ts`)

### App won't start: "Port already in use"

- Railway sets `PORT`. The Dockerfile uses `PORT` or falls back to `AOP_SERVER_PORT`
- Don't override `PORT` — Railway requires it

---

## Cost estimate

- **Supabase Free:** 500MB DB, 50K MAU
- **Railway:** ~$5 credit/month, then pay-as-you-go (~$5–10/mo for a small API)
- **Total:** $0 within free limits, then low cost
