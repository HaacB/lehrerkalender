'use strict';

// HTTP-Client für die Notenverwaltung (noten_webapp).
//
// Alle Aufrufe laufen SERVER-ZU-SERVER: Der Browser spricht ausschließlich mit
// dem Kalender-Server, dieser wiederum mit der Notenverwaltung. Das vermeidet
// CORS, Dritt-Cookies (Safari!) und hält das gemeinsame Geheimnis serverseitig.
//
// Authentisierung: gemeinsames Geheimnis als Bearer-Token
// (NOTEN_CLIENT_SECRET == LK_SSO_SECRET drüben) plus der Kopfzeile
// `X-Noten-Sub` mit der Kennung der handelnden Lehrkraft. Die Notenverwaltung
// liefert daraufhin ausschließlich deren eigene Klassen.

const { config } = require('../config');

function istKonfiguriert() {
  return Boolean(config.noten.baseUrl && config.noten.clientSecret);
}

function fehler(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Führt einen Request gegen die Notenverwaltung aus und liefert das JSON.
// `sub` = stabile Kennung der Lehrkraft (leer bei Aufrufen ohne Nutzerbezug).
async function request(pfad, { method = 'GET', sub = '', body = null } = {}) {
  if (!istKonfiguriert()) {
    throw fehler('Notenverwaltung ist nicht konfiguriert (NOTEN_BASE_URL fehlt).', 503);
  }
  const url = config.noten.baseUrl + pfad;
  const headers = {
    Authorization: `Bearer ${config.noten.clientSecret}`,
    'X-Noten-Client': config.noten.clientId,
    Accept: 'application/json',
  };
  if (sub) headers['X-Noten-Sub'] = sub;
  if (body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(config.noten.timeoutMs),
      redirect: 'manual', // eine Weiterleitung auf /login wäre ein Konfigurationsfehler
    });
  } catch (err) {
    throw fehler(`Notenverwaltung nicht erreichbar: ${err.message}`, 502);
  }

  const text = await res.text();
  let daten = null;
  try {
    daten = text ? JSON.parse(text) : null;
  } catch {
    daten = null;
  }

  if (!res.ok) {
    const msg = (daten && (daten.error || daten.fehler)) || `HTTP ${res.status}`;
    // 401/403 der Notenverwaltung bedeuten für UNSEREN Aufrufer nicht
    // "nicht angemeldet", sondern eine falsche Kopplung -> als 502 melden,
    // damit die App den Nutzer nicht fälschlich ausloggt.
    const status = res.status === 404 ? 404 : res.status === 409 ? 409 : 502;
    throw fehler(`Notenverwaltung: ${msg}`, status);
  }
  if (!daten || typeof daten !== 'object') {
    throw fehler('Notenverwaltung: unerwartete Antwort (kein JSON)', 502);
  }
  return daten;
}

// --- SSO -------------------------------------------------------------------

// Tauscht den Einmal-Code aus der Weiterleitung gegen die Identität ein.
// Antwort der Notenverwaltung: { sub, username, name, rolle }
async function tokenTausch(code, redirectUri) {
  const daten = await request('/sso/token', {
    method: 'POST',
    body: {
      client_id: config.noten.clientId,
      client_secret: config.noten.clientSecret,
      code,
      redirect_uri: redirectUri,
    },
  });
  if (!daten.sub || typeof daten.sub !== 'string') {
    throw fehler('Notenverwaltung: Antwort ohne "sub"', 502);
  }
  return {
    sub: daten.sub.trim().toLowerCase(),
    username: String(daten.username || daten.sub),
    name: daten.name ? String(daten.name) : '',
    rolle: daten.rolle ? String(daten.rolle) : 'teacher',
  };
}

// --- Daten -----------------------------------------------------------------

// Klassen der Lehrkraft (ohne Schülerlisten – die kommen erst auf Abruf).
function klassen(sub) {
  return request('/api/extern/klassen', { sub }).then((d) => ({
    klassen: Array.isArray(d.klassen) ? d.klassen : [],
  }));
}

// Eine Klasse inklusive Schülerliste und Fächern.
function klasse(sub, klasseId) {
  const id = encodeURIComponent(String(klasseId));
  return request(`/api/extern/klassen/${id}`, { sub }).then((d) => d.klasse || null);
}

// Erreichbarkeit + Version prüfen (für die Diagnose in den Einstellungen).
function ping() {
  return request('/api/extern/ping');
}

module.exports = { istKonfiguriert, request, tokenTausch, klassen, klasse, ping };
