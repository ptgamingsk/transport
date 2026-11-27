const project = 'ptgamingsk-transport';
const director = 'zyH3Sv6i5rVjWNpVRjw3bBHBVVM2';
const origin = 'https://ptgamingsk.github.io';
const room = 'transport-dispecing';
const encoder = new TextEncoder();

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function jsonPart(value) {
  return base64url(encoder.encode(JSON.stringify(value)));
}

async function accessToken(env, uid, name) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: env.LIVEKIT_API_KEY,
    sub: uid,
    name,
    nbf: now,
    exp: now + 300,
    video: {
      room, roomJoin: true, canPublish: true, canSubscribe: true,
      canPublishData: false, canPublishSources: ['microphone']
    }
  };
  const content = jsonPart({ alg: 'HS256', typ: 'JWT' }) + '.' + jsonPart(payload);
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(env.LIVEKIT_API_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(content));
  return content + '.' + base64url(new Uint8Array(signature));
}

export default {
  async fetch(request, env) {
    const headers = {
      'Cache-Control': 'no-store', 'Vary': 'Origin',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    const reply = (body, status) => Response.json(body, { status, headers });

    if (new URL(request.url).pathname !== '/token') return reply({ error: 'not_found' }, 404);
    if (request.headers.get('Origin') !== origin) return reply({ error: 'forbidden_origin' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer [A-Za-z0-9._-]{1,4096}$/.test(authorization)) {
      return reply({ error: 'authentication_required' }, 401);
    }
    if (!env.FIREBASE_WEB_API_KEY || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
      return reply({ error: 'unavailable' }, 503);
    }

    try {
      const lookup = new URL('https://identitytoolkit.googleapis.com/v1/accounts:lookup');
      lookup.searchParams.set('key', env.FIREBASE_WEB_API_KEY);
      const identity = await fetch(lookup, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authorization.slice(7) })
      });
      if (!identity.ok) return reply({ error: 'invalid_account' }, identity.status >= 500 ? 503 : 401);
      const user = (await identity.json()).users?.[0];
      const uid = user?.localId;
      if (typeof uid !== 'string' || !uid || user.disabled) return reply({ error: 'invalid_account' }, 401);

      // Verify the token against the Transport rules even for the director.
      const target = uid === director ? 'clockSync/' : 'driverAccounts/';
      const profile = await fetch(
        'https://firestore.googleapis.com/v1/projects/' + project + '/databases/(default)/documents/'
          + target + encodeURIComponent(uid),
        { headers: { Authorization: authorization } }
      );
      if (profile.status >= 500) return reply({ error: 'unavailable' }, 503);
      let name = 'Riaditeľ · PTGamingSK';
      if (uid === director) {
        if (!profile.ok && profile.status !== 404) return reply({ error: 'forbidden' }, 403);
      } else {
        if (!profile.ok) return reply({ error: 'forbidden' }, 403);
        const fields = (await profile.json()).fields;
        if (fields?.enabled?.booleanValue !== true) return reply({ error: 'forbidden' }, 403);
        name = String(fields.name?.stringValue || 'Vodič').slice(0, 100);
      }

      return reply({
        server_url: 'wss://ptgamingsk-transport-qdbwm8jw.livekit.cloud',
        participant_token: await accessToken(env, uid, name)
      }, 200);
    } catch {
      return reply({ error: 'unavailable' }, 503);
    }
  }
};
