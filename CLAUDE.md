# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (hot reload)
npm run dev

# Production
npm start

# Run database migrations
npm run migrate
```

No test runner or linter is configured.

## Architecture

Express.js backend (Node.js >=18, ES modules) for the NUB Studio art platform. Entry point: `src/server.js`.

**Layer flow:** Routes → Controllers → Services / raw SQL via `pg`

```
src/
├── server.js          # App bootstrap, middleware registration, cron jobs
├── config/
│   ├── db.js          # All DB pools
│   ├── logger.js      # Winston
│   └── cloudinaryConfig.js
├── routes/            # 17 modules, all prefixed /api/
├── controllers/       # 19 modules, business logic
├── middlewares/       # JWT auth, XSS sanitize, SQL injection guard
├── services/          # emailService (Brevo), sessionService
└── validators/        # express-validator rules
```

## Database

PostgreSQL on Neon via raw `pg` — no ORM. `src/config/db.js` exposes **5 pools**:

| Pool | DB User | Used for |
|------|---------|----------|
| `pool` (main) | `neondb_owner` | Auth, sessions, cron tasks |
| `poolAdmin` | `usr_admin` | Admin operations |
| `poolArtista` | `usr_artista` | Artist portal |
| `poolCliente` | `usr_cliente` | Client actions |
| `poolVisitante` | `usr_visitante` | Public read-only |

Row-level security is enforced at the database level through these role-specific users. Use the correct pool in controllers based on the role performing the action.

## Authentication & Sessions

- JWT (HS256, 24h TTL) — claims: `sub` (user id), `jti` (token id), `rol`
- `authMiddleware.js` verifies the token **and** checks the session is still active in `historial_login`
- Role-based access: `admin`, `artista`, `cliente`, `visitante`
- 2FA via TOTP (`speakeasy` + QR code) and Gmail-based 2FA (separate route modules)
- Password recovery uses 6-char alphanumeric codes with expiration

## Cron Jobs (server.js)

| Schedule | Task |
|----------|------|
| Hourly | `cleanupExpiredCodes()` — expired recovery codes |
| Daily midnight | `cleanupExpiredSessions()` — expired JWT sessions |
| Configurable | `iniciarCron()` — DB backups |

## Key Environment Variables

```
PORT, FRONTEND_URL
DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
DB_HOST_DIRECT                          # for role-based direct connections
DB_PASS_ADMIN, DB_PASS_ARTISTA, DB_PASS_CLIENTE, DB_PASS_VISITANTE
JWT_SECRET
BREVO_API_KEY                           # primary transactional email
CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
SUPABASE_URL, SUPABASE_KEY
```

## API Route Prefixes

```
/api/auth/            /api/recovery/        /api/2fa/
/api/gmail-2fa/       /api/obras/           /api/artistas/
/api/artista-portal/  /api/categorias/      /api/etiquetas/
/api/tecnicas/        /api/imagenes/        /api/stats/
/api/admin/           /api/admin/monitoreo/ /api/reportes/
/api/estadisticas/    /api/estados/
```

## File Uploads

Multer + `multer-storage-cloudinary` — images go directly to Cloudinary. Config in `src/config/cloudinaryConfig.js`, used in `imagenesRoutes.js`.

## Reports

`exceljs` is used in `Reportescontroller.js` to generate Excel files on demand.
