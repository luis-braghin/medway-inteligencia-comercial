const EXPECTED_PROJECT_REF = 'abcdefghijklmnopqrst';
const EXPECTED_ORIGIN = `https://${EXPECTED_PROJECT_REF}.supabase.co`;
const DEFAULT_TIMEOUT_MS = 10_000;
const AUTH_RESPONSE_LIMIT = 64 * 1024;
const RPC_RESPONSE_LIMIT = 8 * 1024 * 1024;
const TOKEN_EXPIRY_SKEW_MS = 5_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_TOKEN_RE = /^[^\u0000-\u0020\u007f;]{1,8192}$/u;

/** The only RPC surface the hosted portal is allowed to call. */
export const PORTAL_RPC_ALLOWLIST = Object.freeze([
  'medway_portal_login_gate',
  'medway_portal_create_session',
  'medway_portal_check_session',
  'medway_portal_revoke_session',
  'medway_portal_read',
]);

const PORTAL_RPC_NAMES = new Set(PORTAL_RPC_ALLOWLIST);
const INTERNAL_TIMEOUT = Symbol('portal-client-timeout');

export class PortalClientError extends Error {
  constructor(code, message = code, status = 503) {
    super(message);
    this.name = 'PortalClientError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message = code) {
  return new PortalClientError(code, message, 503);
}

function safeString(value, code, { max = 8192 } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw fail(code);
  }
  return value;
}

function normalizeUuid(value, code) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw fail(code);
  return value.toLowerCase();
}

function validateOrigin(value) {
  if (typeof value !== 'string' || value.length === 0) throw fail('PORTAL_CONFIG_INVALID');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw fail('PORTAL_CONFIG_INVALID');
  }
  if (parsed.origin !== EXPECTED_ORIGIN || parsed.protocol !== 'https:'
    || parsed.username || parsed.password || parsed.port
    || (parsed.pathname !== '' && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw fail('PORTAL_PROJECT_MISMATCH');
  }
  return parsed.origin;
}

function validateArgs(args) {
  if (args === undefined || args === null) return {};
  if (typeof args !== 'object' || Array.isArray(args)) throw fail('PORTAL_ARGUMENTS_INVALID');
  const prototype = Object.getPrototypeOf(args);
  if (prototype !== Object.prototype && prototype !== null) throw fail('PORTAL_ARGUMENTS_INVALID');
  return args;
}

function headerValue(response, name) {
  try {
    if (response?.headers && typeof response.headers.get === 'function') return response.headers.get(name);
    if (response?.headers && typeof response.headers === 'object') {
      return response.headers[name] ?? response.headers[name.toLowerCase()] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

function contentLength(response) {
  const value = headerValue(response, 'content-length');
  if (value === null || value === undefined || value === '') return null;
  const length = Number(value);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

function cancelReader(reader) {
  try {
    const result = reader?.cancel?.();
    result?.catch?.(() => {});
  } catch {
    // Cancellation is best effort and must not replace the bounded error.
  }
}

function cancelResponse(response) {
  try {
    const result = response?.body?.cancel?.();
    result?.catch?.(() => {});
  } catch {
    // Cancellation is best effort and must not replace the sanitized error.
  }
}

function deadline(timeoutMs) {
  const controller = new AbortController();
  let reader = null;
  let timedOut = false;
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      cancelReader(reader);
      reject(INTERNAL_TIMEOUT);
    }, timeoutMs);
  });

  async function wait(operation) {
    const operationPromise = Promise.resolve().then(operation);
    operationPromise.catch(() => {});
    return Promise.race([operationPromise, timeoutPromise]);
  }

  return {
    signal: controller.signal,
    wait,
    setReader(value) { reader = value; },
    wasTimedOut() { return timedOut; },
    clear() { clearTimeout(timer); },
  };
}

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new TextEncoder().encode(String(value ?? ''));
}

async function boundedBytes(response, gate, limit, tooLargeCode, timeoutCode) {
  const declared = contentLength(response);
  if (declared !== null && declared > limit) {
    cancelResponse(response);
    throw fail(tooLargeCode);
  }

  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    gate.setReader(reader);
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        let step;
        try {
          step = await gate.wait(() => reader.read());
        } catch (error) {
          if (error === INTERNAL_TIMEOUT) throw fail(timeoutCode);
          throw error;
        }
        if (!step || step.done) break;
        const chunk = bytesOf(step.value);
        total += chunk.byteLength;
        if (total > limit) {
          cancelReader(reader);
          throw fail(tooLargeCode);
        }
        chunks.push(chunk);
      }
    } finally {
      try { reader.releaseLock?.(); } catch { /* best effort */ }
    }
    if (declared !== null && total !== declared) throw fail('PORTAL_RESPONSE_TRUNCATED');
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }

  try {
    if (typeof response?.arrayBuffer === 'function') {
      const bytes = bytesOf(await gate.wait(() => response.arrayBuffer()));
      if (bytes.byteLength > limit) throw fail(tooLargeCode);
      if (declared !== null && bytes.byteLength !== declared) throw fail('PORTAL_RESPONSE_TRUNCATED');
      return bytes;
    }
    if (typeof response?.text === 'function') {
      const bytes = new TextEncoder().encode(String(await gate.wait(() => response.text())));
      if (bytes.byteLength > limit) throw fail(tooLargeCode);
      if (declared !== null && bytes.byteLength !== declared) throw fail('PORTAL_RESPONSE_TRUNCATED');
      return bytes;
    }
    // Small fake fetch implementations used by unit tests may expose json().
    if (typeof response?.json === 'function') {
      const value = await gate.wait(() => response.json());
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      if (bytes.byteLength > limit) throw fail(tooLargeCode);
      if (declared !== null && bytes.byteLength !== declared) throw fail('PORTAL_RESPONSE_TRUNCATED');
      return bytes;
    }
  } catch (error) {
    if (error === INTERNAL_TIMEOUT) throw fail(timeoutCode);
    throw error;
  }
  throw fail('PORTAL_RESPONSE_INVALID');
}

function parseJson(bytes, code) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw fail(code);
  }
}

function validAccessToken(value) {
  return typeof value === 'string' && SAFE_TOKEN_RE.test(value);
}

function sanitizedFailure(phase, error, gate) {
  if (error instanceof PortalClientError) return error;
  if (error === INTERNAL_TIMEOUT || gate.wasTimedOut() || error?.name === 'AbortError') {
    return fail(`${phase}_TIMEOUT`);
  }
  return fail(`${phase}_UNAVAILABLE`);
}

function authRequestBody(config) {
  const body = JSON.stringify({ email: config.gatewayEmail, password: config.gatewayPassword });
  if (new TextEncoder().encode(body).byteLength > AUTH_RESPONSE_LIMIT) throw fail('AUTH_REQUEST_TOO_LARGE');
  return body;
}

export function createPortalClient({ fetchImpl = globalThis.fetch, config, now = () => Date.now(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw fail('PORTAL_FETCH_INVALID');
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw fail('PORTAL_CONFIG_INVALID');
  const origin = validateOrigin(config.origin);
  const publicKey = safeString(config.publicKey, 'PORTAL_CONFIG_INVALID');
  const gatewayEmail = safeString(config.gatewayEmail, 'PORTAL_CONFIG_INVALID', { max: 512 });
  const gatewayPassword = safeString(config.gatewayPassword, 'PORTAL_CONFIG_INVALID', { max: 2048 });
  const gatewayUserId = normalizeUuid(config.gatewayUserId, 'PORTAL_CONFIG_INVALID');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw fail('PORTAL_CONFIG_INVALID');
  if (typeof now !== 'function') throw fail('PORTAL_CONFIG_INVALID');

  let accessToken = null;
  let accessExpiresAt = 0;
  let loginFlight = null;

  async function requestJson(phase, url, options, limit) {
    const gate = deadline(timeoutMs);
    try {
      let response;
      try {
        response = await gate.wait(() => fetchImpl(url, { ...options, signal: gate.signal }));
      } catch (error) {
        throw sanitizedFailure(phase, error, gate);
      }
      const status = Number(response?.status);
      if (!Number.isInteger(status) || status < 100 || status > 599) throw fail(`${phase}_RESPONSE_INVALID`);
      if ((status >= 300 && status < 400) || response?.redirected === true || response?.type === 'opaqueredirect') {
        cancelResponse(response);
        throw fail(`${phase}_REDIRECT`);
      }
      if (status < 200 || status > 299) {
        cancelResponse(response);
        throw fail(`${phase}_REJECTED`);
      }
      const bytes = await boundedBytes(response, gate, limit, `${phase}_RESPONSE_TOO_LARGE`, `${phase}_TIMEOUT`);
      return parseJson(bytes, `${phase}_INVALID_JSON`);
    } catch (error) {
      throw sanitizedFailure(phase, error, gate);
    } finally {
      gate.clear();
    }
  }

  async function authenticateGateway() {
    let body;
    try {
      body = authRequestBody({ gatewayEmail, gatewayPassword });
    } catch (error) {
      throw error instanceof PortalClientError ? error : fail('AUTH_REQUEST_INVALID');
    }
    const payload = await requestJson('AUTH', `${origin}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: publicKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
      redirect: 'manual',
    }, AUTH_RESPONSE_LIMIT);
    const token = payload?.access_token;
    const userId = payload?.user?.id;
    const expiresIn = payload?.expires_in;
    const returnedUserId = typeof userId === 'string' && UUID_RE.test(userId)
      ? userId.toLowerCase()
      : null;
    if (returnedUserId !== gatewayUserId) throw fail('AUTH_IDENTITY_MISMATCH');
    if (!validAccessToken(token) || !Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 86_400) {
      throw fail('AUTH_RESPONSE_INVALID');
    }
    accessToken = token;
    accessExpiresAt = now() + (expiresIn * 1000);
    return token;
  }

  async function gatewayToken() {
    if (accessToken && now() + TOKEN_EXPIRY_SKEW_MS < accessExpiresAt) return accessToken;
    accessToken = null;
    accessExpiresAt = 0;
    if (loginFlight) return loginFlight;
    const flight = authenticateGateway();
    loginFlight = flight;
    try {
      return await flight;
    } finally {
      if (loginFlight === flight) loginFlight = null;
    }
  }

  async function rpc(name, args) {
    if (typeof name !== 'string' || !PORTAL_RPC_NAMES.has(name)) throw fail('PORTAL_RPC_NOT_ALLOWED');
    const checkedArgs = validateArgs(args);
    let body;
    try {
      body = JSON.stringify(checkedArgs);
    } catch {
      throw fail('PORTAL_ARGUMENTS_INVALID');
    }
    if (typeof body !== 'string' || new TextEncoder().encode(body).byteLength > RPC_RESPONSE_LIMIT) {
      throw fail('RPC_REQUEST_TOO_LARGE');
    }
    const token = await gatewayToken();
    try {
      return await requestJson('RPC', `${origin}/rest/v1/rpc/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: {
          apikey: publicKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
        redirect: 'manual',
      }, RPC_RESPONSE_LIMIT);
    } catch (error) {
      // Do not retry the current request. A subsequent call must authenticate
      // again after an upstream authorization rejection.
      if (error?.code === 'RPC_REJECTED') {
        accessToken = null;
        accessExpiresAt = 0;
      }
      throw error;
    }
  }

  return Object.freeze({ rpc });
}

