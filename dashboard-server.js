import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/dashboard.html', ['dashboard.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/dashboard.css', ['dashboard.css', 'text/css']],
  ['/dashboard.js', ['dashboard.js', 'text/javascript']],
  ['/dashboard-shared.js', ['dashboard-shared.js', 'text/javascript']],
  ['/narrator-dashboard.css', ['narrator-dashboard.css', 'text/css']],
  ['/images/spinner.png', ['images/spinner.png', 'image/png']],
  ['/images/pointer.png', ['images/pointer.png', 'image/png']],
  ['/fonts/Lato-Regular.ttf', ['fonts/Lato-Regular.ttf', 'font/ttf']],
  ['/fonts/Lato-Bold.ttf', ['fonts/Lato-Bold.ttf', 'font/ttf']]
]);

export function createDashboardHandler({ client, getGuildData, updateGuildSettings, env = process.env, fetcher = fetch }) {
  const sessions = new Map();
  const origin = new URL(env.DASHBOARD_URL || 'http://localhost:3000').origin;
  const secure = origin.startsWith('https:');
  const configured = Boolean(env.CLIENT_ID && env.DISCORD_CLIENT_SECRET);
  const cookie = (id, age) => `narrator_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const discord = async (route, token) => {
    const response = await fetcher(`https://discord.com/api/v10${route}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Discord is temporarily unavailable. Please sign in again.');
    return response.json();
  };
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https://cdn.discordapp.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    const redirect = (url) => { res.writeHead(302, { Location: url }); res.end(); };
    try {
      const url = new URL(req.url, origin);
      const now = Date.now();
      for (const [key, value] of sessions) if (value.expires <= now) sessions.delete(key);
      const id = /(?:^|;\s*)narrator_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
      const session = sessions.get(id);
      if (url.pathname === '/health') return send(200, { status: client.isReady() ? 'ready' : 'starting' });
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        const contents = await readFile(new URL(`./public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type }); return res.end(contents);
      }
      if (req.method === 'GET' && ['/auth/login', '/auth/discord'].includes(url.pathname)) {
        if (!configured) return send(503, { error: 'Discord login is not configured yet.' });
        if (sessions.size >= 10000) return send(503, { error: 'Please try again later.' });
        const key = randomBytes(32).toString('hex');
        const state = randomBytes(32).toString('hex');
        sessions.set(key, { state, expires: now + 600000 });
        res.setHeader('Set-Cookie', cookie(key, 600));
        return redirect(`https://discord.com/oauth2/authorize?${new URLSearchParams({ client_id: env.CLIENT_ID, redirect_uri: `${origin}/auth/callback`, response_type: 'code', scope: 'identify guilds', state })}`);
      }
      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        if (!session?.state || url.searchParams.get('state') !== session.state || !url.searchParams.get('code')) return send(400, { error: 'Invalid login. Please try again.' });
        sessions.delete(id);
        const response = await fetcher('https://discord.com/api/v10/oauth2/token', {
          method: 'POST', body: new URLSearchParams({ client_id: env.CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: `${origin}/auth/callback` }), signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) return send(401, { error: 'Discord login failed. Please try again.' });
        const token = await response.json();
        const user = await discord('/users/@me', token.access_token);
        const key = randomBytes(32).toString('hex');
        sessions.set(key, { user, token: token.access_token, csrf: randomBytes(32).toString('hex'), expires: now + Math.min(token.expires_in, 28800) * 1000 });
        res.setHeader('Set-Cookie', cookie(key, Math.min(token.expires_in, 28800)));
        return redirect('/dashboard.html');
      }
      if (url.pathname === '/api/session' && req.method === 'GET') return send(200, { configured, user: session?.user ? { id: session.user.id, name: session.user.global_name || session.user.username } : null, csrf: session?.csrf });
      if (url.pathname === '/api/meta' && req.method === 'GET') return send(200, { clientId: env.CLIENT_ID, configured });
      if (!session?.user) return send(401, { error: 'Sign in with Discord to continue.' });
      if (url.pathname === '/api/me' && req.method === 'GET') return send(200, { id: session.user.id, username: session.user.username, avatar: session.user.avatar || null, csrf: session.csrf });
      if (req.method !== 'GET' && (req.headers.origin !== origin || req.headers['x-csrf-token'] !== session.csrf)) return send(403, { error: 'Please reload the dashboard and try again.' });
      if (url.pathname === '/auth/logout' && req.method === 'POST') { sessions.delete(id); res.setHeader('Set-Cookie', cookie('', 0)); return send(200, { ok: true }); }
      const guilds = await discord('/users/@me/guilds', session.token);
      const manageable = guilds.filter(g => (g.owner || (BigInt(g.permissions) & 40n) !== 0n) && client.guilds.cache.has(g.id));
      if (url.pathname === '/api/guilds' && req.method === 'GET') return send(200, manageable.map(g => ({ id: g.id, name: g.name, icon: g.icon || null, installed: true })));
      const match = /^\/api\/guilds\/(\d{17,22})$/.exec(url.pathname);
      if (!match) return send(404, { error: 'Page not found.' });
      if (!manageable.some(g => g.id === match[1])) return send(403, { error: 'Manage Server permission is required.' });
      const guild = client.guilds.cache.get(match[1]);
      // Re-check live membership and permissions before every read or write.
      const member = await guild.members.fetch({ user: session.user.id, force: true });
      if (!member.permissions.has(32n) && !member.permissions.has(8n)) return send(403, { error: 'Manage Server permission is required.' });
      if (req.method === 'GET') return send(200, await getGuildData(guild));
      if (req.method === 'PUT') {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 16384) return send(413, { error: 'Settings are too large.' }); }
        let settings;
        try { settings = JSON.parse(body); } catch { return send(400, { error: 'Invalid settings.' }); }
        const channels = await guild.channels.fetch();
        const roles = await guild.roles.fetch();
        if (typeof settings.roleplayEnabled !== 'boolean' || !['sayChannels', 'adminRoles', 'dungeonMasterRoles'].every(key => Array.isArray(settings[key]) && settings[key].length <= 250 && settings[key].every(v => typeof v === 'string'))) return send(400, { error: 'Invalid settings.' });
        if (settings.sayChannels.some(id => !channels.get(id) || ![0, 5].includes(channels.get(id).type)) || [...settings.adminRoles, ...settings.dungeonMasterRoles].some(id => !roles.has(id) || id === guild.id || roles.get(id).managed)) return send(400, { error: 'Select valid channels and roles from this server.' });
        await updateGuildSettings(guild.id, settings);
        return send(200, { ok: true });
      }
      return send(405, { error: 'Method not allowed.' });
    } catch (error) {
      console.error('Dashboard request failed:', error.message);
      if (!res.headersSent) send(502, { error: 'Unable to complete the request. Please try again.' });
      else res.end();
    }
  };
}
