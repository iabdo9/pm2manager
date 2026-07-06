# PM2 Manager

A secure, self-hosted web application for managing [PM2](https://pm2.keymetrics.io/) processes on
the same Linux server where it runs. Written entirely in **TypeScript**, it talks to PM2 through the
**official `pm2` programmatic API** (never the shell), stores historical metrics and audit logs in
**SQLite** (`better-sqlite3`), and ships a deliberately **minimal, responsive** UI suitable for
server administration.

---

## Features

**Process management (via the official PM2 API)**
- View all processes, with live status, uptime, memory, CPU, restart count
- View full process details, including environment variables
- Start / stop / restart / reload / delete individual processes
- Start all / stop all / restart all / reload all
- Stream application logs in real time (Server-Sent Events, backed by the PM2 event bus)
- Display PM2 daemon status; refresh data without restarting the app

**Dashboard**
- Running / stopped / errored / total process counts
- Overall CPU and memory usage
- Lightweight CPU & memory history charts (from data stored in SQLite)
- Recent activity and recent restarts
- System information (hostname, OS, uptime, load, Node version)

**Historical data (SQLite)**
- Periodic sampling of CPU, memory, status, uptime, restart count with timestamps
- Queryable time-series for charts and troubleshooting, with configurable retention

**Activity log (SQLite)**
- Logins, failed logins, logouts and authentication events
- Process start/stop/restart/reload/delete (and bulk actions)
- Configuration and user-management changes

**Authentication & security**
- Username / password login with **Argon2id** password hashing (`@node-rs/argon2`)
- Session-based auth with secure, `httpOnly`, `SameSite` cookies (sessions persisted in SQLite)
- **Automatic session expiration** (rolling idle timeout)
- **CSRF protection** (synchroniser-token pattern, constant-time verification)
- **Rate limiting** on login / 2FA endpoints (plus a general API limiter)
- **Secure HTTP headers** via Helmet, with a strict Content-Security-Policy
- **Optional TOTP two-factor authentication** (Google Authenticator, Authy, etc.); when enabled for
  a user it is required at login
- First-run bootstrap of an administrator account

---

## Requirements

- **Node.js ≥ 20** (developed and tested on Node 22/24)
- **PM2** installed and runnable by the same OS user that runs this app
  (`npm i -g pm2`). The app connects to that user's PM2 daemon.
- A Linux server (uses `os`/PM2; intended for Linux hosts)
- A C/C++ toolchain is generally **not** required — `better-sqlite3` and `@node-rs/argon2` ship
  prebuilt binaries for common platforms.

---

## Installation

```bash
# 1. Clone / copy the project, then install dependencies
npm install

# 2. Create your environment file and edit it
cp .env.example .env
#   - set a strong SESSION_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#   - optionally set ADMIN_USERNAME / ADMIN_PASSWORD

# 3. Build the TypeScript to plain JavaScript
npm run build

# 4. Start the compiled app
npm start
```

The app creates its SQLite database automatically (default `./data/pm2manager.sqlite`) and, on the
**first run only**, creates an administrator. If you did not set `ADMIN_PASSWORD`, a random password
is generated and printed to the logs **once** — copy it and change it after logging in.

Then open `http://<host>:<port>/` (default `http://127.0.0.1:3000/`).

### Development

```bash
npm run dev        # tsx watch mode, pretty logs
npm run typecheck  # tsc --noEmit
```

---

## Configuration

All configuration is via environment variables (see [`.env.example`](.env.example)). Values are
validated at startup; invalid configuration fails fast.

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Interface to bind. Keep `127.0.0.1` behind a reverse proxy. |
| `PORT` | `3000` | Listen port. |
| `NODE_ENV` | `production` | `production` or `development`. |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-*` (set `true` behind Nginx/Caddy with TLS). |
| `SESSION_SECRET` | *(insecure default)* | **Required in production.** Long random string. |
| `SESSION_TIMEOUT_MINUTES` | `30` | Rolling idle session timeout. |
| `COOKIE_SECURE` | `auto` | `auto` (Secure when `TRUST_PROXY=true`), `true`, or `false`. |
| `LOGIN_RATE_LIMIT_MAX` | `5` | Failed login attempts per window before throttling. |
| `LOGIN_RATE_LIMIT_WINDOW_MINUTES` | `15` | Login rate-limit window. |
| `TOTP_ISSUER` | `PM2 Manager` | Issuer label shown in authenticator apps. |
| `DATABASE_PATH` | `./data/pm2manager.sqlite` | SQLite file path. |
| `METRICS_INTERVAL_SECONDS` | `15` | How often metrics are sampled. |
| `METRICS_RETENTION_DAYS` | `7` | How long history is kept. |
| `LOG_LEVEL` | `info` | `fatal`…`trace`. |
| `ADMIN_USERNAME` | `admin` | First-run admin username. |
| `ADMIN_PASSWORD` | *(empty → random)* | First-run admin password (printed if generated). |

---

## Running under PM2 (deployment example)

An [`ecosystem.config.js`](ecosystem.config.js) is included. Run PM2 Manager **as a single fork-mode
instance** (it holds a single SQLite writer, one metrics collector and one PM2 event-bus listener):

```bash
npm run build
pm2 start ecosystem.config.js
pm2 save            # persist across reboots
pm2 startup         # follow the printed instructions to enable boot startup
```

### Behind a reverse proxy (recommended)

Terminate TLS at Nginx/Caddy and set `TRUST_PROXY=true` and `COOKIE_SECURE=true`. Example Nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Required for live log streaming (SSE):
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

---

## Running as a systemd service (auto-start on boot)

To run PM2 Manager as a managed service that starts automatically on boot, use the provided unit
file [`deploy/pm2manager.service`](deploy/pm2manager.service).

> **Run it as the same unprivileged user whose PM2 processes you want to manage** — PM2 keeps one
> daemon per user (under that user's `~/.pm2`), and this app can only control the daemon of the user
> it runs as. Never run it as root.

1. Build and configure the app on the server:

   ```bash
   cd /opt/pm2manager           # wherever you deployed it
   npm ci --omit=dev || npm install
   npm run build
   cp .env.example .env         # then edit: strong SESSION_SECRET, PORT, etc.
   ```

2. Edit the four `<<< EDIT` values in `deploy/pm2manager.service`:
   - `User=` / `Group=` — the account that owns your PM2 processes (e.g. `deploy`, `ubuntu`)
   - `WorkingDirectory=` — the absolute path to the project
   - `ExecStart=` — the absolute path to `node` (run `which node`; note the nvm path if you use nvm)
   - `Environment=HOME=` and `Environment=PM2_HOME=` — that user's home and `~/.pm2`

3. Install and enable it:

   ```bash
   sudo cp deploy/pm2manager.service /etc/systemd/system/pm2manager.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now pm2manager      # start now and on every boot
   systemctl status pm2manager
   journalctl -u pm2manager -f                 # follow logs
   ```

Manage it with `sudo systemctl {restart,stop,start} pm2manager`.

> **Note — auto-starting your *managed* apps too.** This service starts the *manager*. To have the
> apps that PM2 manages come back automatically after a reboot, set that up separately for the same
> user with PM2's own boot integration: `pm2 startup` (run the printed command) and `pm2 save`.
> The manager simply connects to that user's PM2 daemon.

Prefer to run the manager itself under PM2 instead of systemd? Use
[`ecosystem.config.js`](ecosystem.config.js) with `pm2 start ecosystem.config.js && pm2 save` (see
the section above).

---

## User management

- **Change your password** and **enable/disable 2FA** from the *Settings* view.
- **Administrators** can create and delete users and adjust metrics settings from *Settings*.
- To create or reset an account from the command line:

  ```bash
  npm run build
  node dist/scripts/create-admin.js <username> <password> --admin
  ```

---

## Security considerations

- **Always run behind HTTPS in production** (reverse proxy) and set `TRUST_PROXY=true` /
  `COOKIE_SECURE=true` so the session cookie carries the `Secure` flag and HSTS is enabled.
- **Bind to `127.0.0.1`** unless a proxy is in front; this app grants full control over server
  processes and must not be exposed directly to untrusted networks.
- Set a **strong `SESSION_SECRET`**; the app warns if the insecure default is used in production.
- Passwords are hashed with **Argon2id**; secrets (password hashes, TOTP secrets) are never sent to
  the client. Login uses a constant-time comparison and a dummy verification for unknown users to
  reduce user-enumeration/timing leaks.
- **CSRF**: state-changing requests require a valid `X-CSRF-Token` matching the per-session secret.
- **Rate limiting** protects the login/2FA endpoints against brute force.
- The **CSP** forbids inline scripts/styles and external origins; the frontend uses only same-origin
  assets (the 2FA QR code is delivered as a `data:` image).
- The database and `.env` are git-ignored; keep filesystem permissions tight
  (`chmod 600 .env`, restrict the `data/` directory).
- Deleting a user **immediately revokes their active sessions** (their session rows are purged),
  so access ends at once rather than at the next idle-timeout. Sessions otherwise expire on the
  rolling `SESSION_TIMEOUT_MINUTES` idle window.
- Single-process routes reject the reserved PM2 keyword `all`, so bulk operations are only ever
  reachable through their explicit, dedicated endpoints (there is intentionally no "delete all").
- This app manages processes for the **PM2 daemon of the user that runs it**. Run it as the same
  unprivileged user that owns your PM2 processes — never as root.

---

## API overview

All API responses use a consistent envelope:

```jsonc
{ "ok": true,  "data": { /* ... */ } }
{ "ok": false, "error": { "message": "...", "code": "...", "details": { } } }
```

| Method & path | Purpose |
| --- | --- |
| `GET /api/auth/csrf-token` | Fetch the CSRF token for the session |
| `POST /api/auth/login` | Log in (returns `twoFactorRequired`) |
| `POST /api/auth/2fa` | Complete TOTP login step |
| `POST /api/auth/logout` | Log out |
| `GET /api/auth/me` | Current user |
| `POST /api/auth/change-password` | Change password |
| `POST /api/auth/2fa/setup` · `/enable` · `/disable` | Manage 2FA |
| `GET /api/processes` | List processes |
| `GET /api/processes/:idOrName` | Process detail (incl. env vars) |
| `POST /api/processes/:idOrName/:action` | `start`/`stop`/`restart`/`reload` |
| `DELETE /api/processes/:idOrName` | Delete a process |
| `POST /api/processes/actions/:action` | `start-all`/`stop-all`/`restart-all`/`reload-all` |
| `GET /api/processes/:idOrName/logs/stream` | Live log stream (SSE) |
| `GET /api/dashboard` | Dashboard summary |
| `GET /api/history` · `/history/names` | Metric time-series for charts |
| `GET /api/activity` | Paginated activity/audit log |
| `GET`/`PUT /api/settings` | View / update metrics settings (admin) |
| `GET`/`POST /api/users` · `DELETE /api/users/:id` | User management (admin) |

All `/api` routes except the auth endpoints require an authenticated session; mutating requests
require a valid CSRF token.

---

## Directory structure

```
pm2manager/
├── src/
│   ├── index.ts                 # Bootstrap: DB, admin, PM2, metrics, HTTP server, shutdown
│   ├── app.ts                   # Express app factory (middleware, sessions, routes)
│   ├── config/                  # Env loading + zod validation → typed config
│   ├── types/                   # Shared domain types + module augmentations
│   ├── db/                      # better-sqlite3 connection + schema
│   ├── repositories/            # SQL data-access (users, activity, metrics, settings, sessions)
│   ├── services/                # Business logic
│   │   ├── pm2.service.ts       #   Sole gateway to the PM2 API (promisified, normalised)
│   │   ├── auth.service.ts      #   Argon2 hashing, credentials, user creation
│   │   ├── totp.service.ts      #   TOTP secret / QR / verification
│   │   ├── activity.service.ts  #   Audit logging
│   │   ├── metrics.service.ts   #   Periodic metrics collection + retention
│   │   ├── dashboard.service.ts #   Dashboard aggregation
│   │   └── system.service.ts    #   Host/OS information
│   ├── controllers/             # HTTP handlers (thin; call services, send envelopes)
│   ├── middleware/              # auth, csrf, rate-limit, validation, security, errors
│   ├── routes/                  # Express routers, one per resource
│   ├── validation/              # zod request schemas
│   └── scripts/                 # create-admin CLI
├── public/
│   ├── login.html · app.html    # Auth-gated HTML pages
│   └── static/{css,js}/         # Stylesheet + vanilla JS (api, app, login, chart)
├── data/                        # SQLite database (created at runtime, git-ignored)
├── dist/                        # Compiled JavaScript (build output)
├── ecosystem.config.js          # PM2 deployment config for this app
├── .env.example                 # Environment configuration template
├── tsconfig.json
└── package.json
```

---

## How it works

- **PM2 access** is confined to `src/services/pm2.service.ts`, which wraps the callback-based
  `pm2` API in promises and normalises PM2's raw process descriptions into typed objects. The event
  bus (`pm2.launchBus`) feeds real-time log streaming and process-event auditing.
- **Metrics** are sampled on an interval and written in a single transaction; old samples are pruned
  according to the retention setting.
- **Sessions** are stored in the same SQLite database, so they survive restarts and expire
  automatically.

---

## License

MIT
