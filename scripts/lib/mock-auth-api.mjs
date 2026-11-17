// Tiruan videokit-api (BFF login) KHUSUS E2E. Meniru kontrak nyata:
//   GET /auth/me     → 401 tanpa cookie sesi, 200 profil dengan cookie
//   GET /auth/login  → set cookie sesi lalu 302 ke return_to (menggantikan perjalanan ke SSO Bagdja)
//   GET /auth/logout → hapus cookie lalu 302 ke return_to
//   /avatars*        → meniru kontrak videokit-api avatar (kuota, pending → confirm), file disimpan di memori
//   PUT/GET /r2/:id  → meniru presigned storage
// mode 'always' = selalu login (dipakai e2e:render yang hanya menguji mesin).
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

export const MOCK_API_PORT = 8791;
export const MOCK_USER = { userId: '3f1c2a9e-8d4b-4c1e-9a7f-2b6d5e8c1a40', email: 'tim.e2e@bagdja.com', username: 'tim-e2e' };

export function startMockAuthApi({ mode = 'flow', appOrigin, avatarLimit = 2 }) {
  const stats = { logins: 0, vrmDownloads: 0 };
  const avatars = new Map(); // id → avatar
  const files = new Map(); // fileId → { mime, body }
  const base = `http://localhost:${MOCK_API_PORT}`;
  const readBody = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
  const json = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
  const live = () => [...avatars.values()].filter((a) => !a.deleted);
  const pub = (a) => ({ id: a.id, name: a.name, status: a.status, size_bytes: a.size_bytes, sha256: a.sha256, vrm_version: a.vrm_version, license_commercial: a.license_commercial,
    license_url: a.license_url ?? null, license_authors: a.license_authors ?? null, thumbnail_url: a.status === 'ready' ? `${base}/r2/${a.thumb}` : null, created_at: a.created_at });
  const target = (id, mime) => ({ url: `${base}/r2/${id}`, method: 'PUT', headers: { 'Content-Type': mime }, expires_at: new Date(Date.now() + 1800e3).toISOString() });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const origin = req.headers.origin;
    if (origin === appOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    const loggedIn = mode === 'always' || /(?:^|;\s*)vk_session=ok/.test(req.headers.cookie ?? '');
    if (url.pathname === '/auth/me') {
      if (!loggedIn) { res.statusCode = 401; return res.end('{"message":"Belum login"}'); }
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ ...MOCK_USER, expiresAt: new Date(Date.now() + 3600_000).toISOString() }));
    }
    if (url.pathname === '/auth/login') {
      stats.logins++;
      res.setHeader('Set-Cookie', 'vk_session=ok; Path=/; HttpOnly; SameSite=Lax');
      res.statusCode = 302;
      res.setHeader('Location', url.searchParams.get('return_to') ?? `${appOrigin}/`);
      return res.end();
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.statusCode = 204; return res.end();
    }
    // --- presigned storage tiruan
    const r2 = /^\/r2\/([^/]+)$/.exec(url.pathname);
    if (r2) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      const f = files.get(r2[1]);
      if (!f) { res.statusCode = 404; return res.end(); }
      if (req.method === 'PUT') { f.body = await readBody(req); res.statusCode = 200; return res.end(); }
      if (!f.body) { res.statusCode = 404; return res.end(); }
      if (f.mime === 'application/octet-stream') stats.vrmDownloads++;
      res.setHeader('Content-Type', f.mime);
      res.setHeader('Content-Length', f.body.length);
      return res.end(f.body);
    }
    // --- /avatars (kontrak videokit-api)
    if (url.pathname.startsWith('/avatars')) {
      if (!loggedIn) return json(res, 401, { message: 'Belum login' });
      const m = /^\/avatars(?:\/([^/]+))?(?:\/(confirm|download))?$/.exec(url.pathname);
      const id = m?.[1], action = m?.[2];
      if (!id && req.method === 'GET') {
        const items = live().filter((a) => a.status === 'ready').sort((a, b) => b.created_at.localeCompare(a.created_at)).map(pub);
        return json(res, 200, { items, quota: { used: live().length, limit: avatarLimit } });
      }
      if (!id && req.method === 'POST') {
        const b = JSON.parse((await readBody(req)).toString());
        if (b.license_accepted !== true) return json(res, 400, { message: ['license_accepted must be true'] });
        if (live().length >= avatarLimit) return json(res, 409, { message: `Slot avatar penuh (maks. ${avatarLimit}).` });
        const vrm = randomUUID(), thumb = randomUUID();
        files.set(vrm, { mime: 'application/octet-stream', body: null });
        files.set(thumb, { mime: b.thumbnail_mime_type, body: null });
        const a = { ...b, id: randomUUID(), status: 'pending', vrm, thumb, created_at: new Date().toISOString() };
        avatars.set(a.id, a);
        return json(res, 200, { avatar: pub(a), vrm_upload: target(vrm, 'application/octet-stream'), thumbnail_upload: target(thumb, b.thumbnail_mime_type) });
      }
      const a = id ? avatars.get(id) : undefined;
      if (!a || a.deleted) return json(res, 404, { message: 'Avatar tidak ditemukan' });
      if (action === 'confirm' && req.method === 'POST') {
        const body = files.get(a.vrm)?.body;
        if (!body || !files.get(a.thumb)?.body) return json(res, 409, { message: 'File belum selesai diunggah' });
        if (body.subarray(0, 4).toString() !== 'glTF') { a.deleted = true; return json(res, 422, { message: 'Avatar ditolak: Bukan file glTF biner (.vrm/.glb)' }); }
        a.status = 'ready';
        return json(res, 200, pub(a));
      }
      if (action === 'download' && req.method === 'GET') return json(res, 200, { url: `${base}/r2/${a.vrm}`, expires_at: new Date(Date.now() + 600e3).toISOString(), sha256: a.sha256, size_bytes: a.size_bytes });
      if (!action && req.method === 'PATCH') { a.name = JSON.parse((await readBody(req)).toString()).name; return json(res, 200, pub(a)); }
      if (!action && req.method === 'DELETE') { a.deleted = true; files.delete(a.vrm); files.delete(a.thumb); return json(res, 200, { id: a.id, deleted: true }); }
      return json(res, 404, { message: 'route' });
    }
    if (url.pathname === '/auth/logout') {
      res.setHeader('Set-Cookie', 'vk_session=; Path=/; Max-Age=0');
      res.statusCode = 302;
      res.setHeader('Location', url.searchParams.get('return_to') ?? `${appOrigin}/`);
      return res.end();
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((ok) => server.listen(MOCK_API_PORT, () => ok({ server, stats, avatars })));
}

/** Env build agar app memanggil API tiruan. */
export const mockApiBuildEnv = () => ({ ...process.env, NEXT_PUBLIC_VIDEOKIT_API_URL: `http://localhost:${MOCK_API_PORT}` });
