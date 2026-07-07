// =========================================================
// Pruebas de seguridad del módulo Foro/Blog contra un servidor vivo.
//
// Uso:
//   node scripts/test-foro-seguridad.mjs
//
// Variables opcionales:
//   BASE_URL       (default http://localhost:4000)
//   TOKEN_CLIENTE  JWT válido de un cliente  → habilita pruebas autenticadas
//   TOKEN_ADMIN    JWT válido de un admin    → habilita pruebas de rol
//   POST_ID        id de un post publicado   → pruebas de comentarios/reacciones
// =========================================================
const BASE = process.env.BASE_URL || 'http://localhost:4000';
const TOKEN_CLIENTE = process.env.TOKEN_CLIENTE || '';
const TOKEN_ADMIN = process.env.TOKEN_ADMIN || '';
const POST_ID = process.env.POST_ID || '';

let pass = 0, fail = 0, skip = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, extra = '') => { fail++; console.log(`  ✗ FALLO: ${n} ${extra}`); };
const omit = (n) => { skip++; console.log(`  – omitida (falta token/POST_ID): ${n}`); };

const req = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* respuesta no-JSON */ }
  return { status: res.status, json };
};

console.log(`Servidor: ${BASE}\n`);

// ── 1. Endpoints públicos ────────────────────────────────
console.log('— Público —');
{
  const r = await req('/api/blog/posts');
  r.status === 200 && r.json?.success ? ok('GET /posts responde 200') : bad('GET /posts', `status=${r.status}`);
}
{
  const r = await req('/api/blog/posts/999999/comentarios');
  r.status === 404 ? ok('comentarios de post inexistente → 404') : bad('comentarios post inexistente', `status=${r.status}`);
}
{
  const r = await req('/api/blog/posts/abc/comentarios');
  r.status === 400 ? ok('id de post no numérico → 400') : bad('id no numérico', `status=${r.status}`);
}
{
  const r = await req('/api/blog/posts/999999/reacciones');
  r.status === 404 ? ok('reacciones de post inexistente → 404') : bad('reacciones post inexistente', `status=${r.status}`);
}

// ── 2. Autenticación obligatoria ─────────────────────────
console.log('— Autenticación —');
{
  const r = await req('/api/blog/posts/1/comentarios', { method: 'POST', body: { contenido: 'hola' } });
  r.status === 401 ? ok('comentar sin token → 401') : bad('comentar sin token', `status=${r.status}`);
}
{
  const r = await req('/api/blog/posts/1/reacciones', { method: 'POST', body: { emoji: '❤️' } });
  r.status === 401 ? ok('reaccionar sin token → 401') : bad('reaccionar sin token', `status=${r.status}`);
}
{
  const r = await req('/api/blog/posts/1/comentarios', {
    method: 'POST', token: 'eyJhbGciOiJIUzI1NiJ9.falso.falso', body: { contenido: 'hola' },
  });
  r.status === 401 ? ok('token manipulado → 401') : bad('token manipulado', `status=${r.status}`);
}
{
  const r = await req('/api/blog/admin/palabras-prohibidas');
  r.status === 401 ? ok('palabras prohibidas sin token → 401') : bad('palabras sin token', `status=${r.status}`);
}

// ── 3. Inyecciones (middlewares globales) ────────────────
console.log('— Inyecciones —');
{
  const r = await req('/api/blog/posts/1/comentarios', {
    method: 'POST', token: TOKEN_CLIENTE || 'x',
    body: { contenido: '<script>alert(1)</script>' },
  });
  [400, 401].includes(r.status) ? ok('XSS <script> rechazado') : bad('XSS <script>', `status=${r.status}`);
}
{
  const r = await req('/api/blog/posts/1/comentarios', {
    method: 'POST', token: TOKEN_CLIENTE || 'x',
    body: { contenido: "x' OR 1=1 --" },
  });
  [400, 401].includes(r.status) ? ok('patrón SQLi rechazado') : bad('SQLi', `status=${r.status}`);
}
{
  const r = await req(`/api/blog/posts/1%27%20OR%201=1/comentarios`);
  [400, 404].includes(r.status) ? ok('SQLi en URL rechazado') : bad('SQLi URL', `status=${r.status}`);
}

// ── 4. Pruebas autenticadas (requieren TOKEN_CLIENTE y POST_ID) ──
console.log('— Autenticadas (cliente) —');
if (!TOKEN_CLIENTE || !POST_ID) {
  omit('emoji fuera de lista blanca → 400');
  omit('una reacción por usuario (cambio de emoji, no duplicado)');
  omit('anidación máxima de 3 niveles → 400 en el 4to');
  omit('palabra prohibida → 422');
  omit('comentario con enlace → queda pendiente de moderación');
  omit('rate limit de comentarios → 429 al 6to en un minuto');
} else {
  {
    const r = await req(`/api/blog/posts/${POST_ID}/reacciones`, {
      method: 'POST', token: TOKEN_CLIENTE, body: { emoji: '💩' },
    });
    r.status === 400 ? ok('emoji fuera de lista blanca → 400') : bad('emoji inválido', `status=${r.status}`);
  }
  {
    await req(`/api/blog/posts/${POST_ID}/reacciones`, { method: 'POST', token: TOKEN_CLIENTE, body: { emoji: '❤️' } });
    await req(`/api/blog/posts/${POST_ID}/reacciones`, { method: 'POST', token: TOKEN_CLIENTE, body: { emoji: '🔥' } });
    const r = await req(`/api/blog/posts/${POST_ID}/reacciones`, { token: TOKEN_CLIENTE });
    const total = (r.json?.data?.conteos || []).reduce((a, c) => a + c.total, 0);
    const mia = r.json?.data?.mi_reaccion;
    mia === '🔥' ? ok('una reacción por usuario: la segunda sustituye a la primera') : bad('reacción única', `mi_reaccion=${mia} total=${total}`);
    await req(`/api/blog/posts/${POST_ID}/reacciones`, { method: 'DELETE', token: TOKEN_CLIENTE });
  }
  {
    // Anidación: raíz → n1 → n2 → intento n3 (debe fallar)
    const c0 = await req(`/api/blog/posts/${POST_ID}/comentarios`, { method: 'POST', token: TOKEN_CLIENTE, body: { contenido: 'prueba nivel 0' } });
    const id0 = c0.json?.data?.id_comentario;
    const c1 = await req(`/api/blog/posts/${POST_ID}/comentarios`, { method: 'POST', token: TOKEN_CLIENTE, body: { contenido: 'prueba nivel 1', padre_id: id0 } });
    const id1 = c1.json?.data?.id_comentario;
    const c2 = await req(`/api/blog/posts/${POST_ID}/comentarios`, { method: 'POST', token: TOKEN_CLIENTE, body: { contenido: 'prueba nivel 2', padre_id: id1 } });
    const id2 = c2.json?.data?.id_comentario;
    const c3 = await req(`/api/blog/posts/${POST_ID}/comentarios`, { method: 'POST', token: TOKEN_CLIENTE, body: { contenido: 'prueba nivel 3', padre_id: id2 } });
    c3.status === 400 ? ok('anidación máxima 3 niveles: el 4to → 400') : bad('anidación', `status=${c3.status}`);
    // limpieza
    for (const id of [id2, id1, id0].filter(Boolean))
      await req(`/api/blog/comentarios/${id}`, { method: 'DELETE', token: TOKEN_CLIENTE });
  }
  {
    const r = await req(`/api/blog/posts/${POST_ID}/comentarios`, {
      method: 'POST', token: TOKEN_CLIENTE, body: { contenido: 'visita www.spam-total.com ahora' },
    });
    r.json?.data?.estado === 'pendiente' ? ok('comentario con enlace → pendiente de moderación') : bad('enlace a moderación', `estado=${r.json?.data?.estado}`);
    if (r.json?.data?.id_comentario)
      await req(`/api/blog/comentarios/${r.json.data.id_comentario}`, { method: 'DELETE', token: TOKEN_CLIENTE });
  }
  {
    let ultimo = null;
    for (let i = 0; i < 6; i++) {
      ultimo = await req(`/api/blog/posts/${POST_ID}/comentarios`, {
        method: 'POST', token: TOKEN_CLIENTE, body: { contenido: `prueba rate limit ${i}` },
      });
    }
    ultimo.status === 429 ? ok('rate limit: 6to comentario en un minuto → 429') : bad('rate limit', `status=${ultimo.status}`);
  }
}

// ── 5. Roles ─────────────────────────────────────────────
console.log('— Roles —');
if (!TOKEN_CLIENTE) {
  omit('cliente no accede a rutas de admin → 403');
} else {
  const r = await req('/api/blog/admin/palabras-prohibidas', { token: TOKEN_CLIENTE });
  r.status === 403 ? ok('cliente en ruta admin → 403') : bad('cliente en ruta admin', `status=${r.status}`);
}
if (!TOKEN_ADMIN) {
  omit('admin lista palabras prohibidas → 200');
} else {
  const r = await req('/api/blog/admin/palabras-prohibidas', { token: TOKEN_ADMIN });
  r.status === 200 ? ok('admin lista palabras prohibidas → 200') : bad('admin palabras', `status=${r.status}`);
}

console.log(`\nResultado: ${pass} OK, ${fail} fallos, ${skip} omitidas`);
process.exit(fail ? 1 : 0);
