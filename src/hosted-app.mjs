import { toDashboardDTO } from './dashboard-dto.mjs';
import { createPortalClient } from './portal-client.mjs';

const SESSION_COOKIE = '__Host-medway_session';
const SESSION_MAX_AGE = 3600;
const PROJECT_ORIGIN = 'https://abcdefghijklmnopqrst.supabase.co';
const OPAQUE_TOKEN_RE = /^[a-f0-9]{64}$/u;
const AUTH_TIMEOUT_MS = 10_000;
const REQUEST_BODY_LIMIT = 4 * 1024;
const AUTH_RESPONSE_LIMIT = 64 * 1024;
const RPC_RESPONSE_LIMIT = 8 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_TOKEN_RE = /^[^\u0000-\u0020\u007f;]{1,8192}$/u;
const ASSET_CONTENT_TYPES = Object.freeze({
  'index.html': 'text/html; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'presentation.js': 'text/javascript; charset=utf-8',
  'segments.js': 'text/javascript; charset=utf-8',
  'styles.css': 'text/css; charset=utf-8',
});

const LOGIN_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Medway · Portal de análise</title>
  <meta name="description" content="Acesso ao portal de análise.">
  <link rel="stylesheet" href="/styles.css">
  <script src="/login.js" defer></script>
</head>
<body class="login-page">
  <div class="login-atmosphere" aria-hidden="true">
    <svg class="login-data-art" viewBox="0 0 1448 1086" preserveAspectRatio="xMidYMid slice" fill="none">
      <defs><pattern id="login-dots" width="35" height="34" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.3" fill="#35e4e0"/></pattern><linearGradient id="login-line"><stop stop-color="#1463b3" stop-opacity=".12"/><stop offset="1" stop-color="#55ebe0" stop-opacity=".65"/></linearGradient></defs>
      <circle cx="-5" cy="190" r="278" stroke="#2570ba" stroke-opacity=".17" stroke-width="2"/>
      <path d="M70 710C80 355 337 300 587 305M933 687C1250 674 1400 830 1399 1086M961 480C1204 561 1196 170 1396 213C1470 229 1508 269 1540 313M976 338C1144 287 1114 161 1212 107S1292 56 1326-40" stroke="url(#login-line)" stroke-width="1.5"/>
      <path d="M1030 248H1448V518H1030Z" fill="url(#login-dots)" opacity=".58"/>
      <g fill="#62eae2"><circle cx="1212" cy="107" r="4.5" opacity=".65"/><circle cx="1243" cy="386" r="4.5"/><circle cx="1299" cy="807" r="4.5"/></g>
    </svg>
    <svg class="login-dna" viewBox="0 0 460 500" fill="none"><g stroke="#4dace7" stroke-width="8"><path d="M-55 20C340 10-30 477 410 465M-60 210C150-20 155 545 425 255"/><path d="m-15 52 79 105m-35-97 77 151m-35-129 80 164m-47-134 82 153m-49-96 94 139m-66-79 119 115m-69-51 123 54m-51-14 109 15" stroke-width="5"/></g></svg>
    <svg class="login-health" viewBox="0 0 180 180" fill="none"><path d="M70 20H110V70H160V110H110V160H70V110H20V70H70Z" stroke="#38dcd4" stroke-width="12" stroke-linejoin="round"/></svg>
    <div class="login-note note-top-left">Tecnologia<br>para decisões<br>mais saudáveis<span></span></div>
    <div class="login-note note-top-right">Dados<br>que impulsionam<br>saúde</div>
    <div class="login-note note-bottom-left"><span></span>Inteligência<br>que aproxima<br>resultados</div>
    <div class="login-note note-bottom-right">Mais saúde<br>mais possibilidades<span></span></div>
  </div>
  <main class="content">
    <section class="panel" aria-labelledby="login-title">
      <div class="login-brand"><svg class="brand-logo" role="img" aria-label="Medway" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 171 36"><path fill="#01CFB5" d="M170.246 8.366 158.874 34.77c-.317.744-1.131 1.23-2.038 1.23h-3.47c-1.552 0-2.606-1.377-2.011-2.628l2.875-6.066-8.476-18.918c-.563-1.246.492-2.59 2.027-2.59h3.541c.929 0 1.755.513 2.061 1.278l4.688 11.864h.093l4.464-11.836c.295-.782 1.126-1.306 2.066-1.306h3.514c1.524 0 2.573 1.322 2.038 2.568Zm-24.869 8.623v10.42a.823.823 0 0 1-.82.826h-3.956a.818.818 0 0 1-.82-.825v-.667a11.207 11.207 0 0 1-5.699 1.541c-6.235 0-11.295-5.054-11.295-11.295 0-6.24 5.06-11.295 11.295-11.295 2.076 0 4.027.557 5.694 1.541v-.006a11.295 11.295 0 0 1 5.601 9.76Zm-5.984.005c0-2.94-2.377-5.327-5.306-5.327-2.929 0-5.306 2.388-5.306 5.327 0 2.94 2.377 5.323 5.306 5.323 2.929 0 5.306-2.383 5.306-5.323Zm5.793.4c.005-.099.005-.192.005-.29 0-.098-.005-.191-.005-.284v.573Zm-26.17-11.722h-4.355a.977.977 0 0 0-.978.978v11.902a3.416 3.416 0 0 1-6.831 0V6.65a.977.977 0 0 0-.978-.978h-4.355a.977.977 0 0 0-.978.978v11.902a3.417 3.417 0 0 1-5.83 2.415c-.618-.617-1-1.47-1-2.415V6.65a.977.977 0 0 0-.979-.978h-4.355a.977.977 0 0 0-.978.978v13.088h-.006c0 .781.115 1.535.334 2.256 1.098 3.623 4.765 6.29 9.13 6.29 2.739 0 5.209-1.054 6.935-2.732 1.689 1.83 4.197 2.994 7 2.994 4.53 0 8.295-3.043 9.06-7.043.093-.487.143-.99.143-1.497V6.65a.978.978 0 0 0-.979-.978Z"></path><path fill="#00205B" d="M65.557 7.694c-.639.399-1.235.863-1.781 1.388.54-.536 1.137-1 1.781-1.388ZM82.727.831v26.617a.82.82 0 0 1-.82.825h-3.956a.77.77 0 0 1-.415-.12.81.81 0 0 1-.405-.71v-.755a11.018 11.018 0 0 1-5.689 1.574c-5.47 0-10.01-3.967-10.923-9.191-.016-.098-.038-.197-.054-.3-.011-.088-.028-.18-.039-.268 0-.028-.005-.055-.01-.088-.006-.06-.012-.12-.023-.18-.005-.076-.01-.159-.021-.24v-.028c-.006-.093-.017-.18-.017-.273a9.516 9.516 0 0 1 0-1.11l.017-.273v-.027l.032-.311c0-.033.006-.066.006-.099a.665.665 0 0 0 .01-.104c.012-.087.023-.18.039-.267.016-.11.033-.213.055-.323a11.09 11.09 0 0 1 3.17-6.005 11.548 11.548 0 0 1 1.88-1.48 9.127 9.127 0 0 1 1.31-.646c1.039-.42 2.186-.65 3.405-.683-.071 0-.142.011-.213.011a9.587 9.587 0 0 0-3.203.672c-.453.18-.896.4-1.311.65.393-.245.809-.459 1.23-.655-.006 0-.011.005-.017.005l.033-.016c-.011.005-.022.005-.038.01a8.79 8.79 0 0 1 .519-.229c-.039.017-.071.033-.104.05.038-.017.07-.033.11-.05.087-.033.174-.065.267-.098.087-.038.175-.066.268-.099.033-.016.065-.021.098-.032.055-.017.104-.039.158-.055.11-.033.214-.066.323-.098a9.584 9.584 0 0 1 .607-.153c.092-.022.196-.044.295-.066.098-.016.196-.033.295-.055l.295-.049h.005a2.82 2.82 0 0 0 .197-.027c.07-.005.131-.022.202-.022.087-.01.18-.016.268-.022.082-.01.164-.01.246-.016.07 0 .142-.011.213-.011.136-.006.273-.006.415-.006.093 0 .191.006.284.006h.12c.083 0 .159.005.236.01.098.006.196.012.295.023.087.005.174.01.256.022.05.005.099.01.142.016.088.01.175.022.257.038l.312.05c1.06.185 2.07.519 3.005.983v.115c-.038-.022-.076-.038-.12-.06.038.022.077.038.12.065v-.12c.268.131.525.273.77.426V.825a.827.827 0 0 1 .82-.825h3.957a.838.838 0 0 1 .836.83Zm-5.694 16.213a5.32 5.32 0 0 0-5.312-5.323c-2.929 0-5.306 2.388-5.306 5.323 0 2.94 2.377 5.322 5.306 5.322a5.316 5.316 0 0 0 5.312-5.322Zm-19.59.431c0 .41-.017.765-.066 1.132a.597.597 0 0 1-.596.524H42.284a.598.598 0 0 0-.574.77c.623 1.94 2.46 3.192 4.749 3.192 1.607 0 2.678-.574 3.656-1.749a.614.614 0 0 1 .47-.213h5.191c.448 0 .738.47.53.869-2.093 4.033-5.705 6.372-9.847 6.372-6.06 0-11.137-5.055-11.137-11.088 0-6.033 4.847-11.235 11.022-11.235h.006c6.284 0 11.093 4.94 11.093 11.426Zm-6.563-3.393c-.738-1.683-2.437-2.754-4.541-2.754-1.973 0-3.721 1.027-4.47 2.754a.594.594 0 0 0 .552.825h7.907a.593.593 0 0 0 .552-.825ZM23.13 5.803c-2.738 0-5.207 1.055-6.934 2.733-1.689-1.831-4.197-2.995-7-2.995-4.53 0-8.295 3.044-9.06 7.044-.088.486-.137.989-.137 1.497v13.35c0 .54.437.978.978.978h4.355a.977.977 0 0 0 .978-.978V15.618c0-1.65 1.328-3.263 2.962-3.476a3.398 3.398 0 0 1 2.87.973c.617.617 1 1.47 1 2.415v11.902c0 .54.436.978.977.978h4.355a.977.977 0 0 0 .979-.978V15.618c0-1.65 1.327-3.263 2.961-3.476a3.398 3.398 0 0 1 2.87.973c.617.617 1 1.47 1 2.415v11.902c0 .54.436.978.977.978h4.355a.977.977 0 0 0 .979-.978V14.344a7.75 7.75 0 0 0-.334-2.257c-1.098-3.623-4.77-6.284-9.13-6.284Z"></path></svg></div><span class="eyebrow">CASE TÉCNICO · ACESSO RESTRITO</span>
      <h1 id="login-title">Inteligência comercial.</h1>
      <p class="panel-subtitle">Use a senha da conta de demonstração para continuar.</p>
      <form id="login-form" method="post" action="/auth/login">
        <label for="password">Senha</label>
        <div class="login-password-field">
          <svg class="login-lock" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="10" width="16" height="12" rx="2.5"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/><path d="M12 15v3"/></svg>
          <input id="password" name="password" type="password" placeholder="Digite a senha" autocomplete="current-password" aria-describedby="login-status" required>
          <button id="toggle-password" class="login-password-toggle" type="button" aria-label="Mostrar senha" aria-pressed="false" aria-controls="password"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="eye-slash" d="m3 3 18 18"/></svg></button>
        </div>
        <button class="button login-submit" type="submit"><span>Entrar</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16m-7-7 7 7-7 7"/></svg></button>
        <p id="login-status" role="status" aria-live="polite"></p>
      </form>
      <p class="login-trust"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6L12 2Z"/><path d="m8 12 3 3 5-6"/></svg>Acesso seguro e restrito</p>
    </section>
  </main>
</body>
</html>`;

const LOGIN_JS = `(() => {
  const form = document.getElementById('login-form');
  const password = document.getElementById('password');
  const status = document.getElementById('login-status');
  if (!form || !password || !status) return;
  const submit = form.querySelector('[type="submit"]');
  const toggle = document.getElementById('toggle-password');
  toggle?.addEventListener('click', () => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
  });
  password.addEventListener('input', () => {
    password.removeAttribute('aria-invalid');
    if (!submit.disabled) status.textContent = '';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    submit.querySelector('span').textContent = 'Entrando…';
    status.textContent = 'Validando acesso…';
    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.value }),
      });
      if (!response.ok) {
        status.textContent = response.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
          : response.status >= 500 ? 'Acesso temporariamente indisponível. Tente novamente em instantes.'
          : 'Não foi possível validar o acesso. Confira a senha e tente novamente.';
        if (response.status === 401) password.setAttribute('aria-invalid', 'true');
        throw new Error('login_failed');
      }
      window.location.assign('/');
    } catch {
      if (status.textContent === 'Validando acesso…') status.textContent = 'Não foi possível conectar. Tente novamente em instantes.';
      submit.disabled = false;
      form.removeAttribute('aria-busy');
      submit.querySelector('span').textContent = 'Entrar';
      password.select();
    }
  });
})();`;

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; font-src 'self'; object-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
});

class HostedAppError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.name = 'HostedAppError';
    this.code = code;
    this.status = status;
  }
}

function error(code, status = 500) {
  return new HostedAppError(code, status);
}

function responseHeaders(contentType, extra = {}) {
  const headers = new Headers(SECURITY_HEADERS);
  if (contentType) headers.set('Content-Type', contentType);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

function jsonResponse(status, value, extra = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders('application/json; charset=utf-8', extra),
  });
}

function textResponse(status, body, contentType, extra = {}) {
  return new Response(body, { status, headers: responseHeaders(contentType, extra) });
}

function normalizeUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value) ? value.toLowerCase() : null;
}

function requiredString(value, code) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) throw error(code, 503);
  return value;
}

function readConfig(env) {
  let supabase;
  try {
    supabase = new URL(requiredString(env?.MEDWAY_SUPABASE_URL, 'HOSTED_CONFIG_INVALID'));
  } catch {
    throw error('HOSTED_CONFIG_INVALID', 503);
  }
  if (supabase.protocol !== 'https:' || supabase.username || supabase.password || supabase.port
    || supabase.pathname !== '/' || supabase.search || supabase.hash) {
    throw error('HOSTED_CONFIG_INVALID', 503);
  }
  if (supabase.origin !== PROJECT_ORIGIN) throw error('HOSTED_PROJECT_MISMATCH', 503);
  const publicKey = requiredString(env?.MEDWAY_SUPABASE_PUBLIC_KEY, 'HOSTED_CONFIG_INVALID');
  const viewerEmail = requiredString(env?.MEDWAY_VIEWER_EMAIL, 'HOSTED_CONFIG_INVALID');
  const viewerUserId = normalizeUuid(env?.MEDWAY_VIEWER_USER_ID);
  if (!viewerUserId) throw error('HOSTED_CONFIG_INVALID', 503);
  const gatewayEmail = requiredString(env?.MEDWAY_PORTAL_GATEWAY_EMAIL, 'HOSTED_CONFIG_INVALID');
  const gatewayPassword = requiredString(env?.MEDWAY_PORTAL_GATEWAY_PASSWORD, 'HOSTED_CONFIG_INVALID');
  const gatewayUserId = normalizeUuid(env?.MEDWAY_PORTAL_GATEWAY_USER_ID);
  const rateLimitKey = requiredString(env?.MEDWAY_RATE_LIMIT_KEY, 'HOSTED_CONFIG_INVALID');
  if (!gatewayUserId || gatewayUserId === viewerUserId || rateLimitKey.length < 32) throw error('HOSTED_CONFIG_INVALID', 503);
  return {
    origin: supabase.origin,
    publicKey,
    viewerEmail,
    viewerUserId,
    gatewayEmail, gatewayPassword, gatewayUserId, rateLimitKey,
  };
}

function requestUrl(request) {
  try {
    return new URL(request.url);
  } catch {
    throw error('URL_INVALID', 400);
  }
}

function ensureNoQuery(url) {
  if (url.search) throw error('QUERY_INVALID', 400);
}

function ensurePostOrigin(request, url) {
  if (request.headers.get('origin') !== url.origin) throw error('ORIGIN_NOT_ALLOWED', 403);
}

function cookieValue(request) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  const values = [];
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name !== SESSION_COOKIE) continue;
    try {
      values.push(decodeURIComponent(part.slice(index + 1).trim()));
    } catch {
      return null;
    }
  }
  if (values.length !== 1 || !OPAQUE_TOKEN_RE.test(values[0])) return null;
  return values[0];
}

function sessionCookie(token, maxAge = SESSION_MAX_AGE) {
  const encoded = token ? encodeURIComponent(token) : '';
  return `${SESSION_COOKIE}=${encoded}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function assetEntry(assets, name) {
  if (!assets) return undefined;
  if (assets instanceof Map) {
    for (const key of [name, `/${name}`]) {
      if (assets.has(key)) return assets.get(key);
    }
    return undefined;
  }
  const aliases = {
    'index.html': ['index.html', '/index.html', 'indexHtml', 'index'],
    'app.js': ['app.js', '/app.js', 'appJs', 'app'],
    'styles.css': ['styles.css', '/styles.css', 'stylesCss', 'styles'],
  };
  for (const key of aliases[name] || [name, `/${name}`]) {
    if (Object.prototype.hasOwnProperty.call(assets, key)) return assets[key];
  }
  return undefined;
}

function assetBody(value, defaultType) {
  if (value && typeof value === 'object' && !(value instanceof ArrayBuffer)
    && !(value instanceof Uint8Array) && Object.prototype.hasOwnProperty.call(value, 'body')) {
    return { body: value.body, contentType: value.contentType || defaultType };
  }
  return { body: value, contentType: defaultType };
}

function assetResponse(assets, name) {
  const entry = assetEntry(assets, name);
  if (entry === undefined || entry === null) throw error('ASSET_UNAVAILABLE', 503);
  const { body, contentType } = assetBody(entry, ASSET_CONTENT_TYPES[name]);
  return textResponse(200, body, contentType);
}

function publicAssetResponse(assets, pathname) {
  if (pathname === '/login.js') return textResponse(200, LOGIN_JS, 'text/javascript; charset=utf-8');
  const name = pathname.slice(1);
  if (name === 'styles.css') return assetResponse(assets, name);
  throw error('NOT_FOUND', 404);
}

function contentLength(request) {
  const value = request.headers.get('content-length');
  if (!value) return null;
  if (!/^\d+$/u.test(value)) throw error('BODY_INVALID', 400);
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw error('BODY_TOO_LARGE', 413);
  return length;
}

async function readRequestBytes(request, limit) {
  const declared = contentLength(request);
  if (declared !== null && declared > limit) throw error('BODY_TOO_LARGE', 413);
  if (!request.body) return new Uint8Array(0);
  const deadlineAt = Date.now() + AUTH_TIMEOUT_MS;
  if (request.body.getReader) {
    try {
      return await readStreamBytesWithDeadline(request.body, limit, deadlineAt);
    } catch (caught) {
      if (caught?.code === 'BODY_TOO_LARGE' || caught?.code === 'BODY_TIMEOUT') throw caught;
      throw error('BODY_INVALID', 400);
    }
  }
  try {
    const bytes = new Uint8Array(await runWithDeadline(
      () => request.arrayBuffer(),
      deadlineAt,
      'BODY_TIMEOUT',
      408,
    ));
    if (bytes.byteLength > limit) throw error('BODY_TOO_LARGE', 413);
    return bytes;
  } catch (caught) {
    if (caught?.code) throw caught;
    throw error('BODY_INVALID', 400);
  }
}

function contentType(request) {
  return (request.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
}

async function loginPayload(request) {
  const bytes = await readRequestBytes(request, REQUEST_BODY_LIMIT);
  const type = contentType(request);
  if (type !== 'application/json' && type !== 'application/x-www-form-urlencoded') {
    throw error('CONTENT_TYPE_INVALID', 415);
  }
  const text = new TextDecoder().decode(bytes);
  let password;
  if (type === 'application/json') {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw error('BODY_INVALID', 400);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'password')
      || typeof value.password !== 'string') throw error('BODY_INVALID', 400);
    password = value.password;
  } else {
    const params = new URLSearchParams(text);
    if (params.getAll('password').length !== 1 || [...params.keys()].some((key) => key !== 'password')) {
      throw error('BODY_INVALID', 400);
    }
    password = params.get('password');
  }
  if (typeof password !== 'string' || password.length === 0 || password.length > 2048) {
    throw error('BODY_INVALID', 400);
  }
  return password;
}

async function emptyBody(request) {
  const bytes = await readRequestBytes(request, REQUEST_BODY_LIMIT);
  if (bytes.byteLength !== 0) throw error('BODY_INVALID', 400);
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs = AUTH_TIMEOUT_MS) {
  if (typeof fetchImpl !== 'function') throw error('HOSTED_CONFIG_INVALID', 503);
  const deadlineAt = Date.now() + timeoutMs;
  const controller = new AbortController();
  let timer;
  const operation = Promise.resolve().then(() => fetchImpl(url, { ...init, signal: controller.signal }));
  operation.catch(() => {});
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(error('UPSTREAM_TIMEOUT', 504));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([operation, timeout]);
    return { response, deadlineAt };
  } finally {
    clearTimeout(timer);
  }
}

function responseContentLength(response) {
  const value = response?.headers?.get?.('content-length');
  if (!value || !/^\d+$/u.test(value)) return null;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

function cancelReader(reader) {
  try {
    const pending = reader?.cancel?.();
    pending?.catch?.(() => {});
  } catch {
    // Cancellation is best effort and must not replace the bounded error.
  }
}

async function readStreamBytes(stream, limit, registerReader = () => {}, existingReader = null) {
  const reader = existingReader || stream.getReader();
  registerReader(reader);
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value);
      total += chunk.byteLength;
      if (total > limit) {
        cancelReader(reader);
        throw error('BODY_TOO_LARGE', 413);
      }
      chunks.push(chunk);
    }
  } catch (caught) {
    if (caught?.code) throw caught;
    throw error('UPSTREAM_UNAVAILABLE', 503);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function runWithDeadline(operation, deadlineAt, timeoutCode, timeoutStatus, onTimeout = () => {}) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    onTimeout();
    throw error(timeoutCode, timeoutStatus);
  }
  const operationPromise = Promise.resolve().then(operation);
  operationPromise.catch(() => {});
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(error(timeoutCode, timeoutStatus));
    }, remaining);
  });
  try {
    return await Promise.race([operationPromise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function readStreamBytesWithDeadline(stream, limit, deadlineAt) {
  const reader = stream.getReader();
  return runWithDeadline(
    () => readStreamBytes(stream, limit, () => {}, reader),
    deadlineAt,
    'BODY_TIMEOUT',
    408,
    () => cancelReader(reader),
  );
}

async function responseBytesCore(response, limit, registerReader) {
  const declared = responseContentLength(response);
  if (declared !== null && declared > limit) throw error('UPSTREAM_TOO_LARGE', 502);
  if (response?.body?.getReader) {
    try {
      return await readStreamBytes(response.body, limit, registerReader);
    } catch (caught) {
      if (caught?.code === 'BODY_TOO_LARGE') throw error('UPSTREAM_TOO_LARGE', 502);
      throw caught;
    }
  }
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw error('UPSTREAM_TOO_LARGE', 502);
    return bytes;
  } catch (caught) {
    if (caught?.code) throw caught;
    throw error('UPSTREAM_UNAVAILABLE', 503);
  }
}

async function responseBytes(response, limit, deadlineAt = Date.now() + AUTH_TIMEOUT_MS) {
  let reader = null;
  const operation = responseBytesCore(response, limit, (value) => { reader = value; });
  operation.catch(() => {});
  let timer;
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    cancelReader(reader);
    throw error('UPSTREAM_TIMEOUT', 504);
  }
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      cancelReader(reader);
      reject(error('UPSTREAM_TIMEOUT', 504));
    }, remaining);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function jsonBody(response, limit, deadlineAt) {
  const bytes = await responseBytes(response, limit, deadlineAt);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw error('UPSTREAM_INVALID_JSON', 502);
  }
}

async function authenticatePassword(fetchImpl, config, password) {
  let response;
  let deadlineAt;
  try {
    const fetched = await fetchWithTimeout(fetchImpl, `${config.origin}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: config.publicKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ email: config.viewerEmail, password }),
      redirect: 'manual',
    });
    response = fetched.response;
    deadlineAt = fetched.deadlineAt;
  } catch (caught) {
    if (caught?.code === 'UPSTREAM_TIMEOUT') throw caught;
    const message = String(caught?.message || '');
    if (/Illegal invocation/iu.test(message)) throw error('AUTH_TRANSPORT_RECEIVER', 503);
    if (/redirect/iu.test(message)) throw error('AUTH_TRANSPORT_REDIRECT', 503);
    if (/network|connect|fetch|DNS/iu.test(message)) throw error('AUTH_TRANSPORT_CONNECTION', 503);
    throw error('AUTH_UNAVAILABLE', 503);
  }
  if (!response || response.status >= 500 || response.status === 429 || (response.status >= 300 && response.status < 400)) throw error('AUTH_UNAVAILABLE',503);
  if (response.status < 200 || response.status >= 300) throw error('AUTH_FAILED', 401);
  let payload;
  try {
    payload = await jsonBody(response, AUTH_RESPONSE_LIMIT, deadlineAt);
  } catch (caught) {
    if (caught?.code === 'UPSTREAM_TIMEOUT') throw caught;
    throw error('AUTH_UNAVAILABLE', 503);
  }
  const token = payload?.access_token;
  const userId = normalizeUuid(payload?.user?.id);
  if (!SAFE_TOKEN_RE.test(typeof token === 'string' ? token : '') || userId !== config.viewerUserId) {
    throw error('AUTH_FAILED', 401);
  }
  return token;
}

const portalClients = new WeakMap();
function portalClient(fetchImpl, config) {
  const cached = portalClients.get(fetchImpl);
  if (cached && cached.userId === config.gatewayUserId && cached.password === config.gatewayPassword) return cached.client;
  const client = createPortalClient({fetchImpl, config});
  portalClients.set(fetchImpl,{userId:config.gatewayUserId,password:config.gatewayPassword,client});
  return client;
}
const hex = bytes => [...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
async function tokenHash(token) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))));
}
async function loginSubject(request, config) {
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(config.rateLimitKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const ip=request.headers.get('CF-Connecting-IP') || 'unknown';
  const subject= /^[a-f0-9.:]{1,64}$/i.test(ip) ? ip : 'unknown';
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(subject))));
}
async function validateSession(fetchImpl, config, request) {
  const token = cookieValue(request);
  if (!token) return false;
  const result=await portalClient(fetchImpl,config).rpc('medway_portal_check_session',{p_token_hash:await tokenHash(token)});
  if (typeof result?.valid !== 'boolean') throw error('SESSION_STORE_UNAVAILABLE',503);
  return result.valid;
}
async function readPublication(fetchImpl, config, versionId, request) {
  const token=cookieValue(request);
  if (!token) throw error('AUTH_REQUIRED',401);
  return portalClient(fetchImpl,config).rpc('medway_portal_read',{p_token_hash:await tokenHash(token),p_version_id:versionId});
}

function dashboardVersion(url) {
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== 'version') || url.searchParams.getAll('version').length > 1) {
    throw error('QUERY_INVALID', 400);
  }
  const version = url.searchParams.get('version');
  if (version !== null && !normalizeUuid(version)) throw error('VERSION_INVALID', 400);
  return version ? version.toLowerCase() : null;
}

async function protectedSession(fetchImpl, env, request) {
  let config;
  try {
    config = readConfig(env);
  } catch (caught) {
    throw caught?.code ? caught : error('HOSTED_CONFIG_INVALID', 503);
  }
  if (!(await validateSession(fetchImpl, config, request))) throw error('AUTH_REQUIRED', 401);
  return config;
}

async function handleLogin(request, url, env, fetchImpl) {
  ensureNoQuery(url);
  ensurePostOrigin(request, url);
  const password = await loginPayload(request);
  let config;
  try {
    config = readConfig(env);
  } catch (caught) {
    throw caught?.code ? caught : error('HOSTED_CONFIG_INVALID', 503);
  }
  try {
    const client=portalClient(fetchImpl,config);
    const gate=await client.rpc('medway_portal_login_gate',{p_subject_hash:await loginSubject(request,config)});
    if (typeof gate?.allowed !== 'boolean') throw error('AUTH_UNAVAILABLE',503);
    if (!gate.allowed) throw error('LOGIN_RATE_LIMITED',429);
    await authenticatePassword(fetchImpl, config, password);
    const token=hex(crypto.getRandomValues(new Uint8Array(32)));
    const created=await client.rpc('medway_portal_create_session',{p_token_hash:await tokenHash(token)});
    if (created?.created !== true) throw error('SESSION_STORE_UNAVAILABLE',503);
    return jsonResponse(200, { ok: true }, { 'Set-Cookie': sessionCookie(token) });
  } catch (caught) {
    if (caught?.code === 'AUTH_FAILED' || caught?.code === 'LOGIN_RATE_LIMITED') throw caught;
    if (['AUTH_TRANSPORT_RECEIVER','AUTH_TRANSPORT_REDIRECT','AUTH_TRANSPORT_CONNECTION'].includes(caught?.code)) throw caught;
    if (caught?.code === 'UPSTREAM_TIMEOUT') throw error('AUTH_UNAVAILABLE', 503);
    throw error('AUTH_UNAVAILABLE', 503);
  }
}

async function handleLogout(request, url, env, fetchImpl) {
  ensureNoQuery(url);
  ensurePostOrigin(request, url);
  await emptyBody(request);
  const token=cookieValue(request);
  if (token) {
    const config=readConfig(env);
    const result=await portalClient(fetchImpl,config).rpc('medway_portal_revoke_session',{p_token_hash:await tokenHash(token)});
    if (result?.revoked !== true) throw error('SESSION_REVOKE_UNCONFIRMED',503);
  }
  return jsonResponse(200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
}

function loginResponse(clear = false) {
  return textResponse(200, LOGIN_HTML, 'text/html; charset=utf-8', clear ? { 'Set-Cookie': sessionCookie('', 0) } : {});
}

export function createHostedApp({ assets, architecture, fetchImpl = (input, init) => globalThis.fetch(input, init) } = {}) {
  return async function hostedHandler(request, env = {}) {
    let url;
    try {
      url = requestUrl(request);
      if (!(request instanceof Request) && !request?.headers) throw error('REQUEST_INVALID', 400);
    } catch (caught) {
      return jsonResponse(caught?.status || 400, { code: caught?.code || 'REQUEST_INVALID' });
    }

    try {
      if (url.pathname === '/health') {
        if (request.method !== 'GET') throw error('METHOD_NOT_ALLOWED', 405);
        ensureNoQuery(url);
        return jsonResponse(200, { status: 'ok' });
      }

      if (url.pathname === '/auth/login') {
        if (request.method !== 'POST') throw error('METHOD_NOT_ALLOWED', 405);
        return await handleLogin(request, url, env, fetchImpl);
      }
      if (url.pathname === '/auth/logout') {
        if (request.method !== 'POST') throw error('METHOD_NOT_ALLOWED', 405);
        return await handleLogout(request, url, env, fetchImpl);
      }

      if (request.method !== 'GET') throw error('METHOD_NOT_ALLOWED', 405);

      if (url.pathname === '/' || url.pathname === '/index.html') {
        ensureNoQuery(url);
        let authenticated = false;
        if (cookieValue(request)) authenticated = await validateSession(fetchImpl,readConfig(env),request);
        if (!authenticated) return loginResponse(Boolean(cookieValue(request)));
        return assetResponse(assets, 'index.html');
      }

      if (url.pathname === '/app.js' || url.pathname === '/presentation.js' || url.pathname === '/segments.js') {
        ensureNoQuery(url);
        await protectedSession(fetchImpl, env, request);
        return assetResponse(assets, url.pathname.slice(1));
      }

      if (url.pathname === '/login.js' || url.pathname === '/styles.css') {
        ensureNoQuery(url);
        return publicAssetResponse(assets, url.pathname);
      }

      if (url.pathname === '/api/architecture') {
        ensureNoQuery(url);
        await protectedSession(fetchImpl, env, request);
        const value = typeof architecture === 'function' ? await architecture() : architecture;
        if (value === undefined) throw error('ARCHITECTURE_UNAVAILABLE', 503);
        return jsonResponse(200, value);
      }

      if (url.pathname === '/api/dashboard') {
        const versionId = dashboardVersion(url);
        const config = await protectedSession(fetchImpl, env, request);
        const bundle = await readPublication(fetchImpl, config, versionId, request);
        if (bundle === null || bundle === undefined) throw error('PUBLICATION_NOT_FOUND', 404);
        try {
          return jsonResponse(200, toDashboardDTO(bundle));
        } catch {
          throw error('DASHBOARD_BUNDLE_INVALID', 502);
        }
      }

      throw error('NOT_FOUND', 404);
    } catch (caught) {
      const status = Number.isInteger(caught?.status) ? caught.status : 500;
      const code = typeof caught?.code === 'string' ? caught.code : 'HOSTED_REQUEST_FAILED';
      const headers = status === 429 ? { 'Retry-After':'600' } : status === 405
        ? { Allow: new Set(['/auth/login', '/auth/logout']).has(url?.pathname) ? 'POST' : 'GET' }
        : {};
      return jsonResponse(status, { code }, headers);
    }
  };
}
