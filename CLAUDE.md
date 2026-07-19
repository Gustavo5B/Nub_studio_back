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

### ⚠️ Las migraciones del repo NO reflejan el esquema real de Neon

Varias tablas fueron editadas a mano en Neon y **no coinciden** con los `.sql` de `migrations/`. Antes de escribir cualquier INSERT/UPDATE, **verifica las columnas reales contra la BD**, no contra la migración. Diferencias confirmadas:

- `obras_tamaños` → columnas reales: `id`, `id_obra`, **`id_tamaño`** (FK a la tabla catálogo **`tamaños_disponibles`**), `precio_base`, `cantidad_disponible`, `activo`. (La migración decía `etiqueta/ancho_cm/alto_cm/precio`.)
- `tipos_marco` → PK **`id_tipo_marco`** y precio **`precio_adicional`** (no `id_marco`/`precio`).
- `obras_marcos` → FK `id_obra_tamaño` apunta a `obras_tamaños.id`.
- `cupones.tipo` → CHECK real es `('porcentaje', 'fijo')` (no `'monto'`).
- `ventas.estado` es el **enum `estado_venta`** (`pendiente|pagado|procesando|enviado|entregado|cancelado`) → requiere cast `::estado_venta`. `pedidos.estado` en cambio es varchar.
- `artistas_redes_sociales.red_social` es el enum **`tipo_red_social`** (`instagram|facebook|tiktok|twitter|youtube|website|pinterest|behance`).
- `pgcrypto` está instalado pero **en el esquema `extensions`**, fuera del `search_path` (`"$user", public`). Por eso `gen_salt()`/`crypt()` fallan sin calificar. Para hashear contraseñas en scripts, usa **`bcrypt` costo 12** (igual que `authController`), no pgcrypto.
- `tecnicas` ya trae **`id_categoria`** → el mapeo técnica→categoría existe en la BD; no lo inventes.
- `npm run migrate` está **roto**: `package.json` apunta a `migrate/migrate.js`, carpeta que no existe. Aplica los `.sql` a mano (Neon SQL Editor o script con `pg`).

## Datos sintéticos (seed para ML)

La BD contiene un seed grande para trabajar **clustering** y **sistemas de recomendación** (además de los datos reales, que quedan intactos). Se identifica por marcas y **convive** con los datos reales:

| Entidad | Marca para filtrar | Cantidad aprox. |
|---------|--------------------|-----------------|
| Artistas | `correo LIKE 'artista_seed_%@nub.mx'` | 25 |
| Clientes | `correo LIKE 'cliente_seed_%@nub.mx'` | 400 |
| Admin seed | `correo = 'admin_seed@nub.mx'` | 1 |
| Obras | `slug LIKE 'seed-obra-%'` | 300 |
| Obras dimensionadas (Pintura/Escultura) | `slug LIKE 'seed-dim-obra-%'` | +40 |
| Colecciones | `slug LIKE 'seed-col-%'` | 50 |

Contraseña de **todas** las cuentas seed: `Seed2024!` (hash bcrypt costo 12).

**Diseño pensado para ML:**
- Los 400 clientes se reparten en **6 arquetipos de gusto** por categoría → estructura latente que un clustering debe redescubrir (ground truth para validar).
- Señales de 3 fuerzas para recomendación: **favorito < carrito < compra**. Nadie compra ni pone en el carrito algo que no marcó como favorito.
- Carritos con **distribución de cola larga** realista (≈53% vacíos, resto de 1 a 8 ítems), no cantidad fija.
- Coherencia verificada: técnica real del catálogo → hereda su categoría → imagen del tema correcto; ninguna venta antes de crear la obra; `pedido.total` = suma de sus ventas; municipio/estado consistentes; Pintura/Escultura con dimensiones y precio escalado por tamaño (30×40 ≈ $1.5k → 150×200 ≈ $12k).
- Imágenes: fotos de la Huasteca con licencia libre (Wikimedia Commons) en Cloudinary bajo `nub-studio/seed/{retratos,pintura,ceramica,textil,grabado,paisaje}`.

**Scripts** (`scripts/`, ejecutar desde `Nub_studio_back/`):
- `seedCompleto.mjs` — sube imágenes a Cloudinary y **genera** `migrations/2026-07-15_seed_completo.sql`. Flags: `--reuse-imagenes` (regenera SQL sin re-subir), `--solo-retratos`, `--sin-imagenes` (placeholders).
- `dryRunSeed.mjs` — ejecuta un `.sql` dentro de una transacción y hace **ROLLBACK** (valida sin escribir). Patrón recomendado antes de aplicar cualquier seed.
- `aplicarSeed.mjs` — aplica con COMMIT.

Migraciones de seed: `2026-07-15_seed_completo.sql`, `2026-07-16_obras_dimensiones.sql`, `2026-07-16_carritos_realistas.sql`.

Para **limpiar** el seed: borrar por las marcas de la tabla de arriba (y la carpeta `nub-studio/seed/` en Cloudinary).

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
