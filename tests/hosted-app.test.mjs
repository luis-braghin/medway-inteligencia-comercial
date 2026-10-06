import assert from 'node:assert/strict';
import test from 'node:test';

import { createHostedApp } from '../src/hosted-app.mjs';

const APP_ORIGIN = 'https://portal.example.test';
const SUPABASE_ORIGIN = 'https://abcdefghijklmnopqrst.supabase.co';
const VIEWER_EMAIL = 'viewer@example.test';
const GATEWAY_EMAIL = 'gateway@example.test';
const GATEWAY_PASSWORD = 'gateway-fixture-password';
const VIEWER_ID = '11111111-1111-4111-8111-111111111111';
const GATEWAY_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const PUBLIC_KEY = 'sb_publishable_public';
const GATEWAY_TOKEN = 'gateway.access-token';
const VIEWER_TOKEN = 'viewer.access-token';
const SESSION_TOKEN = 'ab'.repeat(32);
const VERSION = '33333333-3333-4333-8333-333333333333';
const CAPTURED_AT = '2026-10-05T09:00:00.000Z';

const ENV = Object.freeze({
  MEDWAY_SUPABASE_URL: SUPABASE_ORIGIN,
  MEDWAY_SUPABASE_PUBLIC_KEY: PUBLIC_KEY,
  MEDWAY_VIEWER_EMAIL: VIEWER_EMAIL,
  MEDWAY_VIEWER_USER_ID: VIEWER_ID,
  MEDWAY_PORTAL_GATEWAY_EMAIL: GATEWAY_EMAIL,
  MEDWAY_PORTAL_GATEWAY_PASSWORD: GATEWAY_PASSWORD,
  MEDWAY_PORTAL_GATEWAY_USER_ID: GATEWAY_ID,
  MEDWAY_RATE_LIMIT_KEY: 'r'.repeat(32),
});

function responseJson(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function request(pathname, init = {}) {
  return new Request(`${APP_ORIGIN}${pathname}`, init);
}

function sameOriginHeaders(extra = {}) {
  return { Origin: APP_ORIGIN, ...extra };
}

function sessionCookie(token = SESSION_TOKEN) {
  return `__Host-medway_session=${encodeURIComponent(token)}`;
}

function accumulator(cents = '10') {
  return {
    count: 1,
    positiveCount: 1,
    negativeCount: 0,
    zeroCount: 0,
    signedCents: cents,
    positiveCents: cents,
    negativeCents: '0',
    zeroCents: '0',
  };
}

function bundle() {
  const sourceEntries = [
    {
      sourceId: 'b2c-csv',
      sha256: 'a'.repeat(64),
      bytes: 1,
      localReadAt: CAPTURED_AT,
      sourceAsOf: null,
      mode: 'frozen-local-snapshot',
    },
    {
      sourceId: 'b2b-json',
      sha256: 'b'.repeat(64),
      bytes: 2,
      localReadAt: '2026-10-05T09:00:01.000Z',
      sourceAsOf: null,
      mode: 'frozen-local-snapshot',
    },
  ];
  return {
    version_id: VERSION,
    raw: { secret: 'raw-private-payload' },
    manifest: {
      versionId: VERSION,
      capturedAt: CAPTURED_AT,
      publishedAt: '2026-10-05T09:01:00.000Z',
      executionMode: 'supabase-frozen-snapshots',
      transformationVersion: 'test-transform',
      viewFormulaVersion: 'test-view',
      sourceCredentialRightsVerified: false,
      sources: sourceEntries,
      quality: {
        b2c: { row_count: 1, warning_count: 0, warnings: [] },
        b2b: { row_count: 1, warning_count: 0, warnings: [] },
      },
      secret: 'manifest-private-payload',
    },
    views: {
      metadata: {
        versionId: VERSION,
        calculatedAt: '2026-10-05T09:01:00.000Z',
        transformationVersion: 'test-transform',
        capturedAt: { b2c: CAPTURED_AT, b2b: '2026-10-05T09:00:01.000Z' },
        captureMeaning: { b2c: 'frozen', b2b: 'frozen' },
        sourceAsOf: { b2c: null, b2b: null },
        referenceDate: { b2c: null, b2b: null },
        assumptions: [],
        limitations: [],
        secret: 'metadata-private-payload',
      },
      b2c: {
        count: 1,
        currency: 'BRL',
        positiveCount: 1,
        negativeCount: 0,
        zeroCount: 0,
        signedCents: '10',
        positiveCents: '10',
        negativeCents: '0',
        zeroCents: '0',
        ticket: { numeratorCents: '10', denominator: 1 },
        window: { minMonth: '2025-01', maxMonth: '2025-01', monthsB2C: 1 },
        series: {
          month: { '2025-01': accumulator() },
          channel: { Orgânico: accumulator() },
          product: { Curso: accumulator() },
          monthChannel: { '2025-01': { Orgânico: accumulator() } },
          monthProduct: { '2025-01': { Curso: accumulator() } },
        },
        secret: 'b2c-private-payload',
      },
      b2b: {
        count: 1,
        currency: null,
        byStatus: { ativo: { count: 1, licenses: 1, sumMonthlyMinorUnits: '20', currency: null } },
        byPlan: { Plano: { count: 1, licenses: 1, sumMonthlyMinorUnits: '20', currency: null } },
        byRegion: { SP: { count: 1, licenses: 1, sumMonthlyMinorUnits: '20', currency: null } },
        sourceAsOf: null,
        referenceDate: null,
        secret: 'b2b-private-payload',
      },
      total: {
        official: null,
        officialReason: 'unavailable',
        observedComponents: {
          b2c: { signedCents: '10', currency: 'BRL' },
          b2b: { count: 1, licenses: 1, sumMonthlyMinorUnits: '20', currency: null },
        },
        monthlyComposition: null,
        secret: 'total-private-payload',
      },
    },
  };
}

function fakeFetch({
  gatewayLoginUserId = GATEWAY_ID,
  viewerLoginUserId = VIEWER_ID,
  publication = bundle(),
  sessionValid = true,
  gateAllowed = true,
  gatewayAuthStatus = 200,
  viewerAuthStatus = 200,
  rpcStatuses = {},
  readResponse,
} = {}) {
  const calls = [];
  const createdSessions = new Set();
  const revokedSessions = new Set();

  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { /* inspect only sanitized errors */ }
    const call = { url: String(url), init, path: parsed.pathname, body };
    calls.push(call);

    if (parsed.pathname === '/auth/v1/token') {
      const email = body?.email;
      if (email === GATEWAY_EMAIL) {
        if (gatewayAuthStatus !== 200) return responseJson({ error: 'private auth detail' }, gatewayAuthStatus);
        return responseJson({ access_token: GATEWAY_TOKEN, expires_in: 60, user: { id: gatewayLoginUserId } });
      }
      if (email === VIEWER_EMAIL) {
        if (viewerAuthStatus !== 200) return responseJson({ error: 'private auth detail' }, viewerAuthStatus);
        return responseJson({ access_token: VIEWER_TOKEN, expires_in: 60, user: { id: viewerLoginUserId } });
      }
      return responseJson({ error: 'unknown fixture identity' }, 401);
    }

    const rpcMatch = parsed.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/u);
    if (rpcMatch) {
      const name = decodeURIComponent(rpcMatch[1]);
      call.rpc = name;
      if (Object.hasOwn(rpcStatuses, name)) {
        const status = rpcStatuses[name];
        if (status === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://attacker.example/rpc' } });
        return responseJson({ error: 'private rpc detail' }, status);
      }
      if (name === 'medway_portal_login_gate') {
        return responseJson({ allowed: gateAllowed, retryAfterSeconds: 600 });
      }
      if (name === 'medway_portal_create_session') {
        createdSessions.add(body?.p_token_hash);
        return responseJson({ created: true, expiresAt: '2026-10-05T10:00:00.000Z' });
      }
      if (name === 'medway_portal_check_session') {
        const tokenHash = body?.p_token_hash;
        const valid = !revokedSessions.has(tokenHash)
          && (createdSessions.has(tokenHash) || sessionValid);
        return responseJson({ valid });
      }
      if (name === 'medway_portal_revoke_session') {
        revokedSessions.add(body?.p_token_hash);
        return responseJson({ revoked: true });
      }
      if (name === 'medway_portal_read') {
        if (typeof readResponse === 'function') return readResponse(call);
        return responseJson(publication);
      }
      throw new Error(`unexpected_rpc_${name}`);
    }
    throw new Error(`unexpected_fake_route_${parsed.pathname}`);
  };

  return { fetchImpl, calls, createdSessions, revokedSessions };
}

function appWith(fake, options = {}) {
  return createHostedApp({
    fetchImpl: fake.fetchImpl,
    assets: {
      'index.html': '<!doctype html><title>Private dashboard</title>',
      'app.js': 'fetch("/api/dashboard")',
      'presentation.js': 'private-reviewed-aggregate-notes',
      'segments.js': 'private-reviewed-segment-aggregates',
      'styles.css': 'body{font-family:sans-serif}',
    },
    architecture: { status: 'prepared', private: 'architecture detail' },
    ...options,
  });
}

function rpcCalls(fake, name) {
  return fake.calls.filter((call) => call.rpc === name);
}

test('login and logout use gateway RPCs and set a host-only opaque cookie', async () => {
  const fake = fakeFetch({ sessionValid: false });
  const app = appWith(fake);
  const login = await app(request('/auth/login', {
    method: 'POST',
    headers: sameOriginHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ password: 'correct horse battery staple' }),
  }), ENV);
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { ok: true });
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /^__Host-medway_session=[a-f0-9]{64};/u);
  assert.match(cookie, /Path=\//u);
  assert.match(cookie, /Max-Age=3600/u);
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /Secure/u);
  assert.match(cookie, /SameSite=Strict/u);
  assert.doesNotMatch(cookie, /access\.token|gateway\.access/u);

  const authCalls = fake.calls.filter(({ path }) => path === '/auth/v1/token');
  assert.equal(authCalls.length, 2);
  const gatewayAuth = authCalls.find(({ body }) => body.email === GATEWAY_EMAIL);
  const viewerAuth = authCalls.find(({ body }) => body.email === VIEWER_EMAIL);
  assert.equal(gatewayAuth.init.redirect, 'manual');
  assert.equal(gatewayAuth.init.headers.apikey, PUBLIC_KEY);
  assert.equal(gatewayAuth.init.headers.Authorization, undefined);
  assert.deepEqual(gatewayAuth.body, { email: GATEWAY_EMAIL, password: GATEWAY_PASSWORD });
  assert.deepEqual(viewerAuth.body, { email: VIEWER_EMAIL, password: 'correct horse battery staple' });
  assert.equal(rpcCalls(fake, 'medway_portal_login_gate').length, 1);
  assert.equal(rpcCalls(fake, 'medway_portal_create_session').length, 1);

  const logout = await app(request('/auth/logout', {
    method: 'POST',
    headers: sameOriginHeaders({ Cookie: cookie.split(';', 1)[0] }),
  }), ENV);
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/u);
  assert.equal(rpcCalls(fake, 'medway_portal_revoke_session').length, 1);
});

test('default fetch adapter preserves the global fetch receiver for gateway and viewer auth', async () => {
  const fake = fakeFetch({ sessionValid: false });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = function defaultFetchMock(url, init = {}) {
    assert.equal(this, globalThis);
    calls.push({ url: String(url), init });
    return fake.fetchImpl(url, init);
  };
  try {
    const app = createHostedApp({
      assets: { 'index.html': 'private', 'app.js': 'app', 'styles.css': 'styles' },
    });
    const response = await app(request('/auth/login', {
      method: 'POST',
      headers: sameOriginHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password: 'correct horse battery staple' }),
    }), ENV);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls.length, 4);
    assert.equal(calls.filter(({ url }) => url.includes('/auth/v1/token')).length, 2);
    assert.equal(calls.filter(({ url }) => url.includes('/rest/v1/rpc/')).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('manual upstream redirects are rejected without a follow-up request', async () => {
  const authRedirect = {
    calls: [],
    fetchImpl: async (url, init = {}) => {
      authRedirect.calls.push({ url: String(url), init });
      return new Response(null, {
        status: 302,
        headers: { location: 'https://attacker.example/auth' },
      });
    },
  };
  const authResponse = await appWith(authRedirect)(request('/auth/login', {
    method: 'POST',
    headers: sameOriginHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ password: 'secret' }),
  }), ENV);
  assert.equal(authResponse.status, 503);
  assert.deepEqual(await authResponse.json(), { code: 'AUTH_UNAVAILABLE' });
  assert.equal(authRedirect.calls.length, 1);
  assert.equal(authRedirect.calls[0].init.redirect, 'manual');
  assert.equal(new URL(authRedirect.calls[0].url).origin, SUPABASE_ORIGIN);

  const rpcRedirect = fakeFetch({ rpcStatuses: { medway_portal_check_session: 'redirect' } });
  const rpcResponse = await appWith(rpcRedirect)(request('/api/dashboard', { headers: { Cookie: sessionCookie() } }), ENV);
  assert.equal(rpcResponse.status, 503);
  assert.deepEqual(await rpcResponse.json(), { code: 'RPC_REDIRECT' });
  assert.equal(rpcCalls(rpcRedirect, 'medway_portal_check_session').length, 1);
  assert.equal(rpcCalls(rpcRedirect, 'medway_portal_read').length, 0);
});

test('viewer Auth rejects a 2xx response marked as redirected', async () => {
  const fake = fakeFetch({ sessionValid: false });
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/auth/v1/token') {
      let body;
      try { body = JSON.parse(init.body); } catch { body = null; }
      if (body?.email === VIEWER_EMAIL) {
        const response = responseJson({ access_token: VIEWER_TOKEN, expires_in: 60, user: { id: VIEWER_ID } });
        Object.defineProperty(response, 'redirected', { value: true });
        return response;
      }
    }
    return fake.fetchImpl(url, init);
  };
  const response = await appWith(fake, { fetchImpl })(request('/auth/login', {
    method: 'POST',
    headers: sameOriginHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ password: 'secret' }),
  }), ENV);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'AUTH_TRANSPORT_REDIRECT' });
  assert.equal(response.headers.has('set-cookie'), false);
  assert.equal(rpcCalls(fake, 'medway_portal_create_session').length, 0);
});

test('portal client cache is invalidated when the public key rotates', async () => {
  const fake = fakeFetch();
  const app = appWith(fake);
  const first = await app(request('/api/dashboard', { headers: { Cookie: sessionCookie() } }), ENV);
  assert.equal(first.status, 200);
  const rotated = { ...ENV, MEDWAY_SUPABASE_PUBLIC_KEY: 'sb_publishable_rotated' };
  const second = await app(request('/api/dashboard', { headers: { Cookie: sessionCookie() } }), rotated);
  assert.equal(second.status, 200);
  const authCalls = fake.calls.filter(({ path }) => path === '/auth/v1/token');
  assert.equal(authCalls.length, 2);
  const rpcCallsForRead = rpcCalls(fake, 'medway_portal_read');
  assert.equal(rpcCallsForRead.length, 2);
  assert.equal(rpcCallsForRead[1].init.headers.apikey, 'sb_publishable_rotated');
});

test('unauthenticated root is generic, health has no configuration, and public assets carry no data', async () => {
  const fake = fakeFetch();
  const app = appWith(fake);
  const root = await app(request('/'), ENV);
  const html = await root.text();
  assert.equal(root.status, 200);
  assert.match(html, /Portal de análise/u);
  assert.doesNotMatch(html, /Sales Operations|raw-private-payload/u);
  assert.match(html, /src="\/login\.js"/u);
  const unauthenticatedIndex = await app(request('/index.html'), ENV);
  assert.equal(unauthenticatedIndex.status, 200);
  assert.match(await unauthenticatedIndex.text(), /Portal de análise/u);
  const csp = root.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/u);
  assert.doesNotMatch(csp.match(/script-src[^;]*/u)?.[0] || '', /unsafe-inline/u);
  assert.equal(root.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.match(root.headers.get('permissions-policy'), /camera=\(\)/u);

  const health = await app(request('/health'), {});
  assert.equal(health.status, 200);
  const healthText = await health.text();
  assert.deepEqual(JSON.parse(healthText), { status: 'ok' });
  assert.doesNotMatch(healthText, /SUPABASE|version|config/u);

  const script = await app(request('/login.js'), ENV);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /auth\/login/u);
  const css = await app(request('/styles.css'), ENV);
  assert.equal(css.status, 200);
  const appScript = await app(request('/app.js'), ENV);
  assert.equal(appScript.status, 401);
});

test('protected dashboard validates opaque session through portal RPCs and returns DTO only', async () => {
  const fake = fakeFetch();
  const app = appWith(fake);
  const response = await app(request('/api/dashboard?version=' + VERSION, {
    headers: { Cookie: sessionCookie() },
  }), ENV);
  assert.equal(response.status, 200);
  const dto = await response.json();
  assert.equal(dto.versionId, VERSION);
  assert.equal(dto.views.b2c.signedCents, '10');
  assert.equal('raw' in dto, false);
  assert.equal('raw' in dto.views.b2c, false);
  assert.equal('secret' in dto.manifest, false);
  assert.equal('secret' in dto.views.metadata, false);
  assert.equal(JSON.stringify(dto).includes('private-payload'), false);

  const authCalls = fake.calls.filter(({ path }) => path === '/auth/v1/token');
  assert.equal(authCalls.length, 1);
  const checkCall = rpcCalls(fake, 'medway_portal_check_session')[0];
  const readCall = rpcCalls(fake, 'medway_portal_read')[0];
  assert.equal(checkCall.init.headers.apikey, PUBLIC_KEY);
  assert.equal(checkCall.init.headers.Authorization, `Bearer ${GATEWAY_TOKEN}`);
  assert.equal(checkCall.init.redirect, 'manual');
  assert.equal(readCall.init.headers.apikey, PUBLIC_KEY);
  assert.equal(readCall.init.headers.Authorization, `Bearer ${GATEWAY_TOKEN}`);
  assert.equal(readCall.body.p_token_hash, checkCall.body.p_token_hash);
  assert.equal(readCall.body.p_version_id, VERSION);
  assert.match(readCall.body.p_token_hash, /^[a-f0-9]{64}$/u);
  assert.equal(fake.calls.some(({ path }) => path === '/auth/v1/user'), false);

  const protectedScript = await app(request('/app.js', { headers: { Cookie: sessionCookie() } }), ENV);
  assert.equal(protectedScript.status, 200);
  assert.match(await protectedScript.text(), /api\/dashboard/u);
  const protectedIndex = await app(request('/index.html', { headers: { Cookie: sessionCookie() } }), ENV);
  assert.equal(protectedIndex.status, 200);
  assert.match(await protectedIndex.text(), /Private dashboard/u);
});

test('wrong gateway identity fails closed before portal RPC and wrong viewer identity returns 401', async () => {
  const gatewayWrong = fakeFetch({ gatewayLoginUserId: OTHER_ID });
  const gatewayResponse = await appWith(gatewayWrong)(request('/auth/login', {
    method: 'POST',
    headers: sameOriginHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ password: 'secret' }),
  }), ENV);
  assert.equal(gatewayResponse.status, 503);
  assert.deepEqual(await gatewayResponse.json(), { code: 'AUTH_UNAVAILABLE' });
  assert.equal(gatewayWrong.calls.some(({ rpc }) => rpc), false);
  assert.equal(gatewayResponse.headers.has('set-cookie'), false);

  const viewerWrong = fakeFetch({ viewerLoginUserId: OTHER_ID });
  const viewerResponse = await appWith(viewerWrong)(request('/auth/login', {
    method: 'POST',
    headers: sameOriginHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ password: 'secret' }),
  }), ENV);
  assert.equal(viewerResponse.status, 401);
  assert.deepEqual(await viewerResponse.json(), { code: 'AUTH_FAILED' });
  assert.equal(viewerResponse.headers.has('set-cookie'), false);
});

test('CSRF POSTs are rejected before contacting Supabase', async () => {
  const fake = fakeFetch();
  const app = appWith(fake);
  for (const origin of [undefined, 'https://attacker.example']) {
    const headers = { 'Content-Type': 'application/json' };
    if (origin) headers.Origin = origin;
    const response = await app(request('/auth/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ password: 'secret' }),
    }), ENV);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { code: 'ORIGIN_NOT_ALLOWED' });
  }
  assert.equal(fake.calls.length, 0);
});

test('body, query, and upstream response limits fail closed without exposing secrets', async () => {
  const fake = fakeFetch();
  const app = appWith(fake);
  const oversized = await app(request('/auth/login', {
    method: 'POST',
    headers: sameOriginHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ password: 'x'.repeat(5000) }),
  }), ENV);
  assert.equal(oversized.status, 413);
  assert.equal(fake.calls.length, 0);

  const malformed = await app(request('/auth/login', {
    method: 'POST',
    headers: sameOriginHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ password: 'secret', email: 'not-allowed' }),
  }), ENV);
  assert.equal(malformed.status, 400);
  assert.equal(fake.calls.length, 0);

  const query = await app(request('/api/dashboard?version=' + VERSION + '&version=' + VERSION, {
    headers: { Cookie: sessionCookie() },
  }), ENV);
  assert.equal(query.status, 400);
  assert.deepEqual(await query.json(), { code: 'QUERY_INVALID' });

  const huge = fakeFetch({
    readResponse: () => new Response('x', {
      status: 200,
      headers: { 'content-length': String(8 * 1024 * 1024 + 1) },
    }),
  });
  const hugeResponse = await appWith(huge)(request('/api/dashboard', { headers: { Cookie: sessionCookie() } }), ENV);
  assert.equal(hugeResponse.status, 503);
  const hugeText = await hugeResponse.text();
  assert.deepEqual(JSON.parse(hugeText), { code: 'RPC_RESPONSE_TOO_LARGE' });
  assert.doesNotMatch(hugeText, /service|gateway\.access|raw-private/u);
});

test('streaming request limit rejects oversized body without Content-Length', async () => {
  const fake = fakeFetch();
  const app = appWith(fake);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(5000));
      controller.close();
    },
  });
  const response = await app(request('/auth/login', {
    method: 'POST',
    duplex: 'half',
    headers: sameOriginHeaders({ 'Content-Type': 'application/json' }),
    body: stream,
  }), ENV);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { code: 'BODY_TOO_LARGE' });
  assert.equal(fake.calls.length, 0);
});

test('stalled portal RPC body is bounded by the client deadline and cancelled', { timeout: 15_000 }, async () => {
  const fake = fakeFetch({
    readResponse: () => ({
      status: 200,
      headers: new Headers(),
      body: {
        getReader() {
          return {
            read: () => new Promise(() => {}),
            cancel() { fake.cancelled = true; },
            releaseLock() {},
          };
        },
      },
    }),
  });
  const app = appWith(fake);
  const response = await app(request('/api/dashboard', { headers: { Cookie: sessionCookie() } }), ENV);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'RPC_TIMEOUT' });
  assert.equal(fake.cancelled, true);
});

test('missing publication maps to a specific 404 and architecture requires a session', async () => {
  const fake = fakeFetch({ publication: null });
  const app = appWith(fake);
  const missing = await app(request('/api/dashboard', { headers: { Cookie: sessionCookie() } }), ENV);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { code: 'PUBLICATION_NOT_FOUND' });

  const denied = await app(request('/api/architecture'), ENV);
  assert.equal(denied.status, 401);
  const allowed = await app(request('/api/architecture', { headers: { Cookie: sessionCookie() } }), ENV);
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { status: 'prepared', private: 'architecture detail' });
});

test('login gate returns 429 with retry hint before attempting viewer Auth', async () => {
  const fake = fakeFetch({ gateAllowed: false });
  const response = await appWith(fake)(request('/auth/login', {
    method: 'POST',
    headers: sameOriginHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ password: 'secret' }),
  }), ENV);
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { code: 'LOGIN_RATE_LIMITED' });
  assert.equal(response.headers.get('retry-after'), '600');
  assert.equal(fake.calls.filter(({ path }) => path === '/auth/v1/token').length, 1);
  assert.equal(rpcCalls(fake, 'medway_portal_create_session').length, 0);
});

test('Auth and portal RPC outages return 503 without setting or clearing a session cookie', async () => {
  const authDown = fakeFetch({ gatewayAuthStatus: 503 });
  const authResponse = await appWith(authDown)(request('/auth/login', {
    method: 'POST',
    headers: sameOriginHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ password: 'secret' }),
  }), ENV);
  assert.equal(authResponse.status, 503);
  assert.deepEqual(await authResponse.json(), { code: 'AUTH_UNAVAILABLE' });
  assert.equal(authResponse.headers.has('set-cookie'), false);

  const rpcDown = fakeFetch({ rpcStatuses: { medway_portal_check_session: 503 } });
  const rpcResponse = await appWith(rpcDown)(request('/api/dashboard', {
    headers: { Cookie: sessionCookie() },
  }), ENV);
  assert.equal(rpcResponse.status, 503);
  assert.deepEqual(await rpcResponse.json(), { code: 'RPC_REJECTED' });
  assert.equal(rpcResponse.headers.has('set-cookie'), false);
});

test('old opaque cookie is denied after server-side revoke and never reaches read RPC', async () => {
  const fake = fakeFetch({ sessionValid: false });
  const app = appWith(fake);
  const login = await app(request('/auth/login', {
    method: 'POST',
    headers: sameOriginHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ password: 'secret' }),
  }), ENV);
  assert.equal(login.status, 200);
  const oldCookie = login.headers.get('set-cookie').split(';', 1)[0];

  const beforeLogout = await app(request('/api/dashboard', { headers: { Cookie: oldCookie } }), ENV);
  assert.equal(beforeLogout.status, 200);
  const logout = await app(request('/auth/logout', {
    method: 'POST',
    headers: sameOriginHeaders({ Cookie: oldCookie }),
  }), ENV);
  assert.equal(logout.status, 200);
  const replay = await app(request('/api/dashboard', { headers: { Cookie: oldCookie } }), ENV);
  assert.equal(replay.status, 401);
  assert.deepEqual(await replay.json(), { code: 'AUTH_REQUIRED' });
  assert.equal(rpcCalls(fake, 'medway_portal_read').length, 1);
});

test('presentation asset is protected and denied after logout, including query and traversal attempts',async()=>{
  const fake=fakeFetch({sessionValid:false}),app=appWith(fake);
  const anonymous=await app(request('/presentation.js'),ENV);
  assert.equal(anonymous.status,401);
  assert.doesNotMatch(await anonymous.text(),/private-reviewed/);
  const login=await app(request('/auth/login',{method:'POST',headers:sameOriginHeaders({'Content-Type':'application/json'}),body:JSON.stringify({password:'secret'})}),ENV);
  const cookie=login.headers.get('set-cookie').split(';',1)[0];
  const asset=await app(request('/presentation.js',{headers:{Cookie:cookie}}),ENV);
  assert.equal(asset.status,200);
  assert.equal(await asset.text(),'private-reviewed-aggregate-notes');
  assert.match(asset.headers.get('content-type'),/javascript/);
  assert.match(asset.headers.get('cache-control'),/no-store/);
  assert.equal((await app(request('/presentation.js?raw=true',{headers:{Cookie:cookie}}),ENV)).status,400);
  await app(request('/auth/logout',{method:'POST',headers:sameOriginHeaders({Cookie:cookie})}),ENV);
  assert.equal((await app(request('/presentation.js',{headers:{Cookie:cookie}}),ENV)).status,401);
});

test('segment asset is protected and denied after logout, including query and traversal attempts',async()=>{
  const fake=fakeFetch({sessionValid:false}),app=appWith(fake);
  const anonymous=await app(request('/segments.js'),ENV);
  assert.equal(anonymous.status,401);
  assert.doesNotMatch(await anonymous.text(),/private-reviewed/);
  const login=await app(request('/auth/login',{method:'POST',headers:sameOriginHeaders({'Content-Type':'application/json'}),body:JSON.stringify({password:'secret'})}),ENV);
  const cookie=login.headers.get('set-cookie').split(';',1)[0];
  const asset=await app(request('/segments.js',{headers:{Cookie:cookie}}),ENV);
  assert.equal(asset.status,200);
  assert.equal(await asset.text(),'private-reviewed-segment-aggregates');
  assert.match(asset.headers.get('content-type'),/javascript/);
  assert.match(asset.headers.get('cache-control'),/no-store/);
  assert.equal((await app(request('/segments.js?raw=true',{headers:{Cookie:cookie}}),ENV)).status,400);
  await app(request('/auth/logout',{method:'POST',headers:sameOriginHeaders({Cookie:cookie})}),ENV);
  assert.equal((await app(request('/segments.js',{headers:{Cookie:cookie}}),ENV)).status,401);
});

test('wrong project configuration fails before network and never accepts a service-key fallback', async () => {
  const fake = fakeFetch();
  const app = appWith(fake);
  const response = await app(request('/api/dashboard', { headers: { Cookie: sessionCookie() } }), {
    ...ENV,
    MEDWAY_SUPABASE_URL: 'https://other-project.supabase.co',
    MEDWAY_SUPABASE_SERVICE_KEY: 'forbidden-fixture-service-key',
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'HOSTED_PROJECT_MISMATCH' });
  assert.equal(fake.calls.length, 0);
});
