// Tiruan videokit-api (BFF login) KHUSUS E2E. Meniru kontrak nyata:
//   GET /auth/me     → 401 tanpa cookie sesi, 200 profil dengan cookie
//   GET /auth/login  → set cookie sesi lalu 302 ke return_to (menggantikan perjalanan ke SSO Bagdja)
//   GET /auth/logout → hapus cookie lalu 302 ke return_to
// mode 'always' = selalu login (dipakai e2e:render yang hanya menguji mesin).
import { createServer } from 'node:http';

export const MOCK_API_PORT = 8791;
export const MOCK_USER = { userId: '3f1c2a9e-8d4b-4c1e-9a7f-2b6d5e8c1a40', email: 'tim.e2e@bagdja.com', username: 'tim-e2e' };

export function startMockAuthApi({ mode = 'flow', appOrigin }) {
  const stats = { logins: 0 };
  const server = createServer((req, res) => {
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
    if (url.pathname === '/auth/logout') {
      res.setHeader('Set-Cookie', 'vk_session=; Path=/; Max-Age=0');
      res.statusCode = 302;
      res.setHeader('Location', url.searchParams.get('return_to') ?? `${appOrigin}/`);
      return res.end();
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((ok) => server.listen(MOCK_API_PORT, () => ok({ server, stats })));
}

/** Env build agar app memanggil API tiruan. */
export const mockApiBuildEnv = () => ({ ...process.env, NEXT_PUBLIC_VIDEOKIT_API_URL: `http://localhost:${MOCK_API_PORT}` });
