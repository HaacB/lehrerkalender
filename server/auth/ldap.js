'use strict';

// LDAP-/Active-Directory-Authentifizierung per Bind.
// Portiert aus der Notentabellen-SPA, damit beide Projekte dieselbe, erprobte
// Anmeldelogik gegen den Schul-AD nutzen. Aktiv nur bei AUTH_MODE=ldap;
// sämtliche Parameter kommen aus der .env (siehe .env.example), damit das
// Setup ohne Code-Änderung scharfgeschaltet werden kann.
//
// Zwei Modi:
//   - Direkt-Bind (empfohlen, LDAP_BIND_USER_TEMPLATE gesetzt): Der Nutzer
//     bindet sofort mit eigener Kennung (z. B. `SNRD\name`) + Passwort — kein
//     Service-Account nötig. Kennung/Anzeigename werden danach best effort über
//     dieselbe Verbindung gelesen.
//   - Service-Account (Default): Mit Lese-Konto binden, Nutzer per Filter
//     suchen, dann mit gefundener DN + eingegebenem Passwort erneut binden.
//
// Rückgabe bei Erfolg: { loginSub, name? }. Bei falschen Anmeldedaten: null.
// Bei technischen Fehlern (Netz/TLS/Fehlkonfiguration) wird ein Fehler mit
// status=502 geworfen. Rollen/Provisionierung kommen NICHT aus dem AD.

const fs = require('node:fs');
const { Client, InvalidCredentialsError } = require('ldapts');

const { config } = require('../config');

// RFC 4515: Sonderzeichen im Suchfilter maskieren (LDAP-Injection vermeiden).
function escapeFilter(wert) {
  return String(wert).replace(
    /[\\*() ]/g,
    (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0')
  );
}

// Attributwerte aus ldapts können String, String[] oder Buffer sein.
function alsString(v) {
  if (Array.isArray(v)) return v.length ? String(v[0]) : undefined;
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return v === undefined ? undefined : String(v);
}

// TLS-Optionen für ldaps:// einmalig aus der Konfiguration ableiten.
let tlsOptionsCache;
function tlsOptions() {
  if (tlsOptionsCache !== undefined) return tlsOptionsCache;
  const o = {};
  if (config.ldap.tlsCaPath) o.ca = fs.readFileSync(config.ldap.tlsCaPath);
  if (config.ldap.tlsRejectUnauthorized === false) o.rejectUnauthorized = false;
  tlsOptionsCache = Object.keys(o).length ? o : null;
  return tlsOptionsCache;
}

function clientOptions() {
  const tls = tlsOptions();
  return {
    url: config.ldap.url,
    timeout: 5000,
    connectTimeout: 5000,
    ...(tls ? { tlsOptions: tls } : {}),
  };
}

// Technische Fehler (Netz/TLS/Config) -> 502, deutlich vom 401-Anmeldefehler
// getrennt. Die Ursache bleibt für das Server-Log erhalten.
function technischerFehler(e) {
  const err = new Error('LDAP-Anmeldedienst nicht erreichbar');
  err.status = 502;
  err.cause = e;
  return err;
}

async function authenticate(username, password) {
  if (!username || !password) return null;
  return config.ldap.userBindTemplate
    ? authenticateDirekt(username, password)
    : authenticateService(username, password);
}

// Service-Account-Modus: suchen, dann mit der DN des Nutzers verifizieren.
async function authenticateService(username, password) {
  const opts = clientOptions();
  const suchClient = new Client(opts);
  let benutzerDn;
  let loginSub;
  let name;
  try {
    try {
      await suchClient.bind(config.ldap.bindDn, config.ldap.bindPw);
    } catch (e) {
      // Bind des Service-Accounts scheitert -> Konfigurationsproblem
      // (LDAP_BIND_DN/LDAP_BIND_PW), kein Anmeldefehler des Nutzers.
      throw technischerFehler(
        new Error(`Service-Account-Bind fehlgeschlagen — LDAP_BIND_DN/LDAP_BIND_PW prüfen: ${e.message}`)
      );
    }
    const filter = config.ldap.userFilter.replace('{{username}}', escapeFilter(username));
    const { searchEntries } = await suchClient.search(config.ldap.baseDn, {
      scope: 'sub',
      filter,
      attributes: ['dn', config.ldap.loginAttr, config.ldap.nameAttr],
    });
    if (searchEntries.length !== 1) return null; // nicht gefunden oder mehrdeutig
    const eintrag = searchEntries[0];
    benutzerDn = String(eintrag.dn);
    loginSub = alsString(eintrag[config.ldap.loginAttr]) ?? username;
    name = alsString(eintrag[config.ldap.nameAttr]);
  } catch (e) {
    if (e && e.status) throw e; // bereits als technischer Fehler markiert
    throw technischerFehler(e);
  } finally {
    await suchClient.unbind().catch(() => undefined);
  }

  // Schritt 2: Passwort gegen die gefundene Benutzer-DN prüfen.
  const verifyClient = new Client(opts);
  try {
    await verifyClient.bind(benutzerDn, password);
  } catch (e) {
    if (e instanceof InvalidCredentialsError) return null; // Passwort falsch
    throw technischerFehler(e);
  } finally {
    await verifyClient.unbind().catch(() => undefined);
  }

  return name !== undefined ? { loginSub, name } : { loginSub };
}

// Direkt-Bind: Der Nutzer meldet sich sofort mit eigener Kennung + Passwort an.
async function authenticateDirekt(username, password) {
  const bindName = config.ldap.userBindTemplate.replace('{{username}}', username);
  const client = new Client(clientOptions());
  try {
    try {
      await client.bind(bindName, password);
    } catch (e) {
      if (e instanceof InvalidCredentialsError) return null; // Passwort falsch
      throw technischerFehler(e); // TLS/Netz/…
    }

    // Anmeldung bereits bestätigt. Attribute sind optional: best effort über die
    // authentifizierte Verbindung lesen; klappt es nicht (z. B. fehlende
    // Leserechte), fällt loginSub auf den eingegebenen Namen zurück.
    let loginSub = username;
    let name;
    try {
      const filter = config.ldap.userFilter.replace('{{username}}', escapeFilter(username));
      const { searchEntries } = await client.search(config.ldap.baseDn, {
        scope: 'sub',
        filter,
        attributes: ['dn', config.ldap.loginAttr, config.ldap.nameAttr],
      });
      if (searchEntries.length === 1) {
        const eintrag = searchEntries[0];
        loginSub = alsString(eintrag[config.ldap.loginAttr]) ?? username;
        name = alsString(eintrag[config.ldap.nameAttr]);
      }
    } catch {
      /* Attributsuche optional — Anmeldung gilt bereits als erfolgreich */
    }
    return name !== undefined ? { loginSub, name } : { loginSub };
  } finally {
    await client.unbind().catch(() => undefined);
  }
}

module.exports = { authenticate, escapeFilter };
