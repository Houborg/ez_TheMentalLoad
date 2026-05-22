// packages/backend/src/aula/aula-auth.ts
import crypto from 'node:crypto';
import { AulaTokens, AulaLoginError } from './aula-types.js';

const AULA_CLIENT_ID = '_99949a54b8b65423862aac1bf629599ed64231607a';
const AULA_REDIRECT_URI = 'https://www.aula.dk/portal/oauth2callback.php';
const AULA_AUTHORIZE_URL = 'https://login.aula.dk/simplesaml/module.php/oidc/authorize.php';
const AULA_TOKEN_URL = 'https://login.aula.dk/simplesaml/module.php/oidc/token.php';
const MITID_INITIALIZE_URL = 'https://nemlog-in.mitid.dk/login/mitid/initialize';

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36';

// ── Cookie jar ──────────────────────────────────────────────────────────────

class CookieJar {
  private cookies = new Map<string, string>();

  update(response: Response): void {
    const setCookie = response.headers.getSetCookie?.() ?? [];
    for (const header of setCookie) {
      const [nameValue] = header.split(';');
      if (!nameValue) continue;
      const eq = nameValue.indexOf('=');
      if (eq < 0) continue;
      const name = nameValue.slice(0, eq).trim();
      const value = nameValue.slice(eq + 1).trim();
      this.cookies.set(name, value);
    }
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ── HTML form parser ─────────────────────────────────────────────────────────

function extractFormAction(html: string): string | null {
  const match = html.match(/<form[^>]+action=["']([^"']+)["']/i);
  return match?.[1] ?? null;
}

function extractHiddenInputs(html: string): Record<string, string> {
  const inputs: Record<string, string> = {};
  const re = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const nameMatch = m[0].match(/name=["']([^"']+)["']/i);
    const valueMatch = m[0].match(/value=["']([^"']*)["']/i);
    if (nameMatch?.[1]) {
      inputs[nameMatch[1]] = valueMatch?.[1] ?? '';
    }
  }
  return inputs;
}

function extractQueryParam(url: string, param: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get(param);
  } catch {
    return null;
  }
}

// ── Main login flow ──────────────────────────────────────────────────────────

export async function aulaLogin(
  username: string,
  password: string,
  totpCode: string,
): Promise<AulaTokens> {
  const jar = new CookieJar();
  const { verifier, challenge } = generatePkce();

  try {
    const brokerUrl = await step_followAuthorizationRedirects(jar, challenge);
    const mitidStartUrl = await step_selectMitIdAtBroker(jar, brokerUrl);
    const { authSessionId, verificationToken } = await step_initializeMitId(jar, mitidStartUrl);
    const samlPayload = await step_authenticateToken(
      jar, authSessionId, verificationToken, username, password, totpCode,
    );
    const aulaSamlPayload = await step_processBrokerSaml(jar, samlPayload);
    const oauthCode = await step_processAulaSaml(jar, aulaSamlPayload);
    return await step_exchangeCodeForTokens(oauthCode, verifier);
  } catch (err) {
    if (err instanceof AulaLoginError) throw err;
    throw new AulaLoginError(
      `Unexpected error during Aula login: ${err instanceof Error ? err.message : String(err)}`,
      'unknown',
    );
  }
}

async function step_followAuthorizationRedirects(jar: CookieJar, challenge: string): Promise<string> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: AULA_CLIENT_ID,
    redirect_uri: AULA_REDIRECT_URI,
    scope: 'aula-sensitive',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: crypto.randomBytes(16).toString('hex'),
  });

  let currentUrl = `${AULA_AUTHORIZE_URL}?${params}`;

  for (let i = 0; i < 10; i++) {
    const res = await fetch(currentUrl, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Cookie: jar.header() },
    });
    jar.update(res);

    if (res.status === 200) {
      return currentUrl;
    }

    const location = res.headers.get('location');
    if (!location) throw new AulaLoginError('Lost redirect chain at authorization step', 'unknown');

    currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;

    if (currentUrl.includes('broker.unilogin.dk')) {
      return currentUrl;
    }
  }

  throw new AulaLoginError('Too many redirects in authorization step', 'unknown');
}

async function step_selectMitIdAtBroker(jar: CookieJar, brokerUrl: string): Promise<string> {
  const res = await fetch(brokerUrl, {
    headers: { 'User-Agent': USER_AGENT, Cookie: jar.header() },
  });
  jar.update(res);
  const html = await res.text();

  console.log('[aula-auth] broker URL:', brokerUrl);
  console.log('[aula-auth] broker page (first 2000 chars):', html.slice(0, 2000));

  // Direct link to MitID
  const mitidMatch = html.match(/href=["'](https:\/\/nemlog-in\.mitid\.dk[^"']+)["']/i)
    ?? html.match(/action=["'](https:\/\/nemlog-in\.mitid\.dk[^"']+)["']/i);
  if (mitidMatch?.[1]) return mitidMatch[1];

  // Keycloak-style: look for nemlogin3 IDP hint link or button
  const nemloginMatch = html.match(/href=["']([^"']*nemlogin3[^"']*)["']/i)
    ?? html.match(/href=["']([^"']*kc_idp_hint=nemlogin[^"']*)["']/i)
    ?? html.match(/href=["']([^"']*mitid[^"']*)["']/i);
  if (nemloginMatch?.[1]) {
    const url = nemloginMatch[1].startsWith('http') ? nemloginMatch[1] : new URL(nemloginMatch[1], brokerUrl).href;
    console.log('[aula-auth] following nemlogin link:', url);
    const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT, Cookie: jar.header() } });
    jar.update(r);
    const loc = r.headers.get('location');
    console.log('[aula-auth] nemlogin redirect location:', loc);
    if (loc?.includes('nemlog-in.mitid.dk')) return loc;
    if (loc) return loc; // follow further
  }

  // Fallback: submit the page form and follow redirect
  const action = extractFormAction(html);
  const inputs = extractHiddenInputs(html);
  console.log('[aula-auth] form action:', action, 'inputs:', Object.keys(inputs));
  const body = new URLSearchParams({ ...inputs });
  const formRes = await fetch(action ?? brokerUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'User-Agent': USER_AGENT,
      Cookie: jar.header(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  jar.update(formRes);
  const location = formRes.headers.get('location');
  console.log('[aula-auth] form POST redirect:', location);
  if (location?.includes('nemlog-in.mitid.dk')) return location;
  if (location) return location; // return whatever redirect we get and try to continue
  throw new AulaLoginError(`Could not find MitID start URL at broker. Page title: ${html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? 'unknown'}`, 'unknown');
}

async function step_initializeMitId(
  jar: CookieJar,
  mitidUrl: string,
): Promise<{ authSessionId: string; verificationToken: string }> {
  let currentUrl = mitidUrl;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(currentUrl, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Cookie: jar.header() },
    });
    jar.update(res);
    if (res.status === 200) {
      const html = await res.text();
      const vtMatch = html.match(/verificationToken["'\s:]+["']([^"']+)["']/i);
      if (!vtMatch?.[1]) throw new AulaLoginError('No verificationToken in MitID init page', 'unknown');

      const initRes = await fetch(MITID_INITIALIZE_URL, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          Cookie: jar.header(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ verificationToken: vtMatch[1] }),
      });
      jar.update(initRes);
      const data = await initRes.json() as Record<string, unknown>;
      const authSessionId = data['authenticationSessionId'] as string | undefined;
      if (!authSessionId) throw new AulaLoginError('No authenticationSessionId from MitID', 'unknown');
      return { authSessionId, verificationToken: vtMatch[1] };
    }
    const location = res.headers.get('location');
    if (!location) throw new AulaLoginError('Lost redirect at MitID init', 'unknown');
    currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
  }
  throw new AulaLoginError('Could not reach MitID initialization page', 'unknown');
}

async function step_authenticateToken(
  jar: CookieJar,
  authSessionId: string,
  verificationToken: string,
  username: string,
  password: string,
  totpCode: string,
): Promise<{ action: string; inputs: Record<string, string> }> {
  const usernameRes = await fetch(
    `https://nemlog-in.mitid.dk/login/mitid/username`,
    {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: jar.header(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, authenticationSessionId: authSessionId, verificationToken }),
    },
  );
  jar.update(usernameRes);
  if (!usernameRes.ok) {
    throw new AulaLoginError('Invalid MitID username', 'invalid_credentials');
  }

  const passwordRes = await fetch(
    `https://nemlog-in.mitid.dk/login/mitid/password`,
    {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: jar.header(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password, authenticationSessionId: authSessionId }),
    },
  );
  jar.update(passwordRes);
  if (!passwordRes.ok) {
    throw new AulaLoginError('Invalid MitID password', 'invalid_credentials');
  }

  const totpRes = await fetch(
    `https://nemlog-in.mitid.dk/login/mitid/totp`,
    {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: jar.header(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ totpCode, authenticationSessionId: authSessionId }),
    },
  );
  jar.update(totpRes);
  if (!totpRes.ok) {
    const body = await totpRes.text().catch(() => '');
    const code = body.includes('expired') ? 'expired_code' : 'invalid_credentials';
    throw new AulaLoginError('MitID TOTP code rejected', code);
  }

  const completeRes = await fetch(
    `https://nemlog-in.mitid.dk/login/mitid`,
    {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: jar.header(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ authenticationSessionId: authSessionId, verificationToken }),
    },
  );
  jar.update(completeRes);
  const html = await completeRes.text();
  const action = extractFormAction(html);
  const inputs = extractHiddenInputs(html);
  if (!action || !inputs['SAMLResponse']) {
    throw new AulaLoginError('No SAML response after MitID authentication', 'unknown');
  }
  return { action, inputs };
}

async function step_processBrokerSaml(
  jar: CookieJar,
  samlPayload: { action: string; inputs: Record<string, string> },
): Promise<{ action: string; inputs: Record<string, string> }> {
  const body = new URLSearchParams(samlPayload.inputs);
  const res = await fetch(samlPayload.action, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Cookie: jar.header(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  jar.update(res);
  const html = await res.text();

  if (html.includes('KONTAKT') || html.includes('role')) {
    const action = extractFormAction(html);
    const inputs = extractHiddenInputs(html);
    const roleBody = new URLSearchParams({ ...inputs, role: 'KONTAKT' });
    const roleRes = await fetch(action ?? samlPayload.action, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: jar.header(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: roleBody.toString(),
    });
    jar.update(roleRes);
    const roleHtml = await roleRes.text();
    const finalAction = extractFormAction(roleHtml);
    const finalInputs = extractHiddenInputs(roleHtml);
    if (!finalAction || !finalInputs['SAMLResponse']) {
      throw new AulaLoginError('No SAML after broker role selection', 'unknown');
    }
    return { action: finalAction, inputs: finalInputs };
  }

  const action = extractFormAction(html);
  const inputs = extractHiddenInputs(html);
  if (!action || !inputs['SAMLResponse']) {
    throw new AulaLoginError('No SAML response from broker', 'unknown');
  }
  return { action, inputs };
}

async function step_processAulaSaml(
  jar: CookieJar,
  samlPayload: { action: string; inputs: Record<string, string> },
): Promise<string> {
  const body = new URLSearchParams(samlPayload.inputs);
  let res = await fetch(samlPayload.action, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'User-Agent': USER_AGENT,
      Cookie: jar.header(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  jar.update(res);

  for (let i = 0; i < 10; i++) {
    const location = res.headers.get('location');
    if (!location) break;

    const code = extractQueryParam(location, 'code');
    if (code) return code;

    res = await fetch(location, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Cookie: jar.header() },
    });
    jar.update(res);
  }

  throw new AulaLoginError('Could not extract OAuth code from Aula SAML flow', 'unknown');
}

async function step_exchangeCodeForTokens(code: string, verifier: string): Promise<AulaTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: AULA_REDIRECT_URI,
    client_id: AULA_CLIENT_ID,
    code_verifier: verifier,
  });

  const res = await fetch(AULA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new AulaLoginError(`Token exchange failed: ${res.status}`, 'unknown');
  }

  const data = await res.json() as Record<string, unknown>;
  const accessToken = data['access_token'] as string | undefined;
  const refreshToken = data['refresh_token'] as string | undefined;
  const expiresIn = data['expires_in'] as number | undefined;

  if (!accessToken || !refreshToken) {
    throw new AulaLoginError('Token response missing access_token or refresh_token', 'unknown');
  }

  const expiresAt = new Date(Date.now() + (expiresIn ?? 3600) * 1000).toISOString();
  return { accessToken, refreshToken, expiresAt };
}

// ── Token refresh ─────────────────────────────────────────────────────────────

export async function aulaRefresh(refreshToken: string): Promise<AulaTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: AULA_CLIENT_ID,
  });

  const res = await fetch(AULA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Aula token refresh failed: ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const accessToken = data['access_token'] as string | undefined;
  const newRefreshToken = (data['refresh_token'] as string | undefined) ?? refreshToken;
  const expiresIn = data['expires_in'] as number | undefined;

  if (!accessToken) throw new Error('Refresh response missing access_token');

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt: new Date(Date.now() + (expiresIn ?? 3600) * 1000).toISOString(),
  };
}
