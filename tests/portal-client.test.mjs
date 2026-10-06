import assert from 'node:assert/strict';
import test from 'node:test';

import { createPortalClient, PortalClientError, PORTAL_RPC_ALLOWLIST } from '../src/portal-client.mjs';

const ORIGIN = 'https://abcdefghijklmnopqrst.supabase.co';
const GATEWAY_USER_ID = '11111111-1111-4111-8111-111111111111';
const CONFIG = Object.freeze({
  origin: ORIGIN,
  publicKey: 'sb_publishable_fixture',
  gatewayEmail: 'gateway@example.invalid',
  gatewayPassword: 'fixture-password',
  gatewayUserId: GATEWAY_USER_ID,
});
const TOKEN = 'fixture-gateway-access-token';

function jsonResponse(value, status = 200, headers = new Headers()) {
  return { status, headers, json: async () => value, body: { cancel() {} } };
}

function textResponse(value, status = 200, headers = new Headers()) {
  return { status, headers, text: async () => value, body: { cancel() {} } };
}

function authPayload(expiresIn = 60, userId = GATEWAY_USER_ID) {
  return { access_token: TOKEN, expires_in: expiresIn, user: { id: userId } };
}

function portal(fetchImpl, extra = {}) {
  return createPortalClient({ fetchImpl, config: CONFIG, ...extra });
}

test('exposes exactly the five portal RPC names and rejects aliases before fetch', async () => {
  let calls = 0;
  const client = portal(async () => { calls += 1; return jsonResponse({ ok: true }); });
  assert.deepEqual(PORTAL_RPC_ALLOWLIST, [
    'medway_portal_login_gate',
    'medway_portal_create_session',
    'medway_portal_check_session',
    'medway_portal_revoke_session',
    'medway_portal_read',
  ]);
  await assert.rejects(client.rpc('medway_portal_read_v2', {}), (error) => error.code === 'PORTAL_RPC_NOT_ALLOWED');
  await assert.rejects(client.rpc('medway_read_publication', {}), (error) => error.code === 'PORTAL_RPC_NOT_ALLOWED');
  assert.equal(calls, 0);
});

test('pins the Supabase origin and rejects credentials, paths and alternate projects', () => {
  const fetchImpl = async () => jsonResponse({});
  for (const origin of [
    'https://other.supabase.co',
    `${ORIGIN}/rest/v1`,
    `https://user:pass@${ORIGIN.slice('https://'.length)}`,
    `${ORIGIN}?x=1`,
    'http://abcdefghijklmnopqrst.supabase.co',
  ]) {
    assert.throws(
      () => createPortalClient({ fetchImpl, config: { ...CONFIG, origin } }),
      (error) => error instanceof PortalClientError && ['PORTAL_PROJECT_MISMATCH', 'PORTAL_CONFIG_INVALID'].includes(error.code),
    );
  }
});

test('authenticates once, validates gateway identity and sends only public key plus gateway bearer', async () => {
  const calls = [];
  const client = portal(async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/auth/v1/token')) return jsonResponse(authPayload());
    return jsonResponse({ ok: true });
  });
  assert.deepEqual(await client.rpc('medway_portal_read', { p_version_id: null }), { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.headers.apikey, CONFIG.publicKey);
  assert.equal(JSON.parse(calls[0].options.body).email, CONFIG.gatewayEmail);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.apikey, CONFIG.publicKey);
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[1].options.redirect, 'manual');
  assert.equal(JSON.parse(calls[1].options.body).p_version_id, null);
  assert.equal(JSON.stringify(calls).includes(CONFIG.gatewayPassword), true);
  assert.equal(Object.keys(client).sort().join(','), 'rpc');
});

test('concurrent RPCs share one gateway login and cached token', async () => {
  let authCalls = 0;
  let rpcCalls = 0;
  const client = portal(async (url) => {
    if (url.includes('/auth/v1/token')) {
      authCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return jsonResponse(authPayload());
    }
    rpcCalls += 1;
    return jsonResponse({ rpcCalls });
  });
  const results = await Promise.all([
    client.rpc('medway_portal_read', { p: 1 }),
    client.rpc('medway_portal_read', { p: 2 }),
    client.rpc('medway_portal_check_session', { p: 3 }),
  ]);
  assert.equal(authCalls, 1);
  assert.equal(rpcCalls, 3);
  assert.deepEqual(results.map((result) => result.rpcCalls), [1, 2, 3]);
});

test('expires the in-memory gateway token and authenticates again without storing refresh tokens', async () => {
  let currentTime = 0;
  let authCalls = 0;
  const client = portal(async (url) => {
    if (url.includes('/auth/v1/token')) {
      authCalls += 1;
      return jsonResponse(authPayload(10));
    }
    return jsonResponse({ ok: true });
  }, { now: () => currentTime });
  await client.rpc('medway_portal_read', {});
  currentTime = 20_000;
  await client.rpc('medway_portal_read', {});
  assert.equal(authCalls, 2);
});

test('rejects a valid token response for the wrong gateway identity without leaking upstream details', async () => {
  const upstreamSecret = 'upstream-private-body';
  const client = portal(async (url) => {
    if (url.includes('/auth/v1/token')) return jsonResponse(authPayload(60, '22222222-2222-4222-8222-222222222222'));
    return textResponse(upstreamSecret, 200);
  });
  await assert.rejects(client.rpc('medway_portal_read', {}), (error) => {
    assert.equal(error.code, 'AUTH_IDENTITY_MISMATCH');
    assert.equal(error.status, 503);
    assert.equal(error.message.includes(upstreamSecret), false);
    assert.equal(String(error.stack).includes(upstreamSecret), false);
    return true;
  });
});

test('rejects auth redirects and does not follow them', async () => {
  let calls = 0;
  const client = portal(async () => {
    calls += 1;
    return { status: 302, headers: new Headers({ location: 'https://attacker.invalid' }), body: { cancel() {} } };
  });
  await assert.rejects(client.rpc('medway_portal_read', {}), (error) => error.code === 'AUTH_REDIRECT' && error.status === 503);
  assert.equal(calls, 1);
});

test('sanitizes RPC errors and never retries a rejected response', async () => {
  let calls = 0;
  const bodySecret = 'rpc-private-response';
  const client = portal(async (url) => {
    calls += 1;
    if (url.includes('/auth/v1/token')) return jsonResponse(authPayload());
    return textResponse(bodySecret, 502);
  });
  await assert.rejects(client.rpc('medway_portal_read', {}), (error) => {
    assert.equal(error.code, 'RPC_REJECTED');
    assert.equal(error.status, 503);
    assert.equal(error.message.includes(bodySecret), false);
    return true;
  });
  assert.equal(calls, 2);
});

test('rejects RPC redirect without following it or retrying', async () => {
  let rpcCalls = 0;
  const client = portal(async (url) => {
    if (url.includes('/auth/v1/token')) return jsonResponse(authPayload());
    rpcCalls += 1;
    return { status: 307, headers: new Headers({ location: 'https://other.invalid' }), body: { cancel() {} } };
  });
  await assert.rejects(client.rpc('medway_portal_read', {}), (error) => error.code === 'RPC_REDIRECT');
  assert.equal(rpcCalls, 1);
});

test('bounds auth response before parsing and cancels oversized body', async () => {
  let cancelled = false;
  const client = portal(async (url) => {
    if (!url.includes('/auth/v1/token')) return jsonResponse({ ok: true });
    return {
      status: 200,
      headers: new Headers({ 'content-length': String(64 * 1024 + 1) }),
      body: { cancel() { cancelled = true; } },
    };
  });
  await assert.rejects(client.rpc('medway_portal_read', {}), (error) => error.code === 'AUTH_RESPONSE_TOO_LARGE');
  assert.equal(cancelled, true);
});

test('bounds RPC response and cancels an oversized stream without retry', async () => {
  let rpcCalls = 0;
  let cancelled = false;
  const client = portal(async (url) => {
    if (url.includes('/auth/v1/token')) return jsonResponse(authPayload());
    rpcCalls += 1;
    return {
      status: 200,
      headers: new Headers(),
      body: {
        getReader() {
          let emitted = false;
          return {
            async read() {
              if (emitted) return { done: true };
              emitted = true;
              return { done: false, value: new Uint8Array(8 * 1024 * 1024 + 1) };
            },
            cancel() { cancelled = true; },
            releaseLock() {},
          };
        },
      },
    };
  });
  await assert.rejects(client.rpc('medway_portal_read', {}), (error) => error.code === 'RPC_RESPONSE_TOO_LARGE');
  assert.equal(rpcCalls, 1);
  assert.equal(cancelled, true);
});

test('returns sanitized invalid JSON and never retries the read RPC', async () => {
  let rpcCalls = 0;
  const client = portal(async (url) => {
    if (url.includes('/auth/v1/token')) return jsonResponse(authPayload());
    rpcCalls += 1;
    return textResponse('not-json');
  });
  await assert.rejects(client.rpc('medway_portal_read', {}), (error) => error.code === 'RPC_INVALID_JSON');
  assert.equal(rpcCalls, 1);
});

test('maps network and timeout failures to status 503 without exposing the token', async () => {
  const networkSecret = 'network-secret-token';
  const networkClient = portal(async () => { throw new Error(`failed ${networkSecret}`); });
  await assert.rejects(networkClient.rpc('medway_portal_read', {}), (error) => {
    assert.equal(error.code, 'AUTH_UNAVAILABLE');
    assert.equal(error.status, 503);
    assert.equal(error.message.includes(networkSecret), false);
    assert.equal(String(error.stack).includes(networkSecret), false);
    return true;
  });

  const timeoutClient = portal(() => new Promise(() => {}), { timeoutMs: 15 });
  await assert.rejects(timeoutClient.rpc('medway_portal_read', {}), (error) => error.code === 'AUTH_TIMEOUT' && error.status === 503);
});

test('rejects malformed arguments before authentication', async () => {
  let calls = 0;
  const client = portal(async () => { calls += 1; return jsonResponse(authPayload()); });
  await assert.rejects(client.rpc('medway_portal_read', []), (error) => error.code === 'PORTAL_ARGUMENTS_INVALID');
  await assert.rejects(client.rpc('medway_portal_read', new Date()), (error) => error.code === 'PORTAL_ARGUMENTS_INVALID');
  assert.equal(calls, 0);
});

