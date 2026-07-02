'use strict';

// Lädt und validiert die Umgebungskonfiguration aus .env
require('dotenv').config();

const fs = require('fs');
const path = require('path');

function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

const AUTH_MODE = (process.env.AUTH_MODE || 'dev').toLowerCase();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  masterKey: process.env.MASTER_KEY || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  secureCookies: bool(process.env.SECURE_COOKIES, false),
  // Fremd-Herkünfte, die die App per <iframe> einbetten dürfen (z. B. Nextcloud
  // "Externe Seiten"). Kommagetrennte Origins, z. B. "https://cloud.schule.de".
  // Leer = kein cross-site-Embedding (Standard, sicherstes Verhalten: SameSite=Lax
  // + X-Frame-Options SAMEORIGIN). Gesetzt -> SameSite=None;Secure-Cookie und
  // frame-ancestors werden für diese Herkünfte geöffnet (siehe server/index.js).
  embedAncestors: (process.env.EMBED_ANCESTORS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  authMode: AUTH_MODE,
  devAllowedUsers: (process.env.DEV_ALLOWED_USERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  // LDAP-/Active-Directory-Konfiguration. Zwei Modi (siehe server/auth/ldap.js):
  //   - Direkt-Bind (empfohlen): LDAP_BIND_USER_TEMPLATE gesetzt -> kein
  //     Service-Account nötig, der Nutzer bindet mit eigener Kennung + Passwort.
  //   - Service-Account: LDAP_BIND_DN/LDAP_BIND_PW eines Lese-Kontos, der Nutzer
  //     wird per Filter gesucht und danach mit seiner DN verifiziert.
  ldap: {
    url: process.env.LDAP_URL || '',
    baseDn: process.env.LDAP_BASE_DN || '',
    // Suchfilter mit Platzhalter {{username}} (AD-Default: sAMAccountName).
    userFilter: process.env.LDAP_USER_FILTER || '(sAMAccountName={{username}})',
    // Attribut für die stabile Login-Kennung bzw. den Anzeigenamen.
    loginAttr: process.env.LDAP_LOGIN_ATTR || 'sAMAccountName',
    nameAttr: process.env.LDAP_NAME_ATTR || 'displayName',
    // Direkt-Bind-Vorlage, z. B. `SNRD\{{username}}` oder `{{username}}@snrd.local`.
    userBindTemplate: process.env.LDAP_BIND_USER_TEMPLATE || '',
    // Service-Account (nur ohne Direkt-Bind-Vorlage benötigt).
    bindDn: process.env.LDAP_BIND_DN || '',
    bindPw: process.env.LDAP_BIND_PW || '',
    // TLS für ldaps:// — Pfad zur PEM der internen CA (empfohlen) bzw.
    // Zertifikatsprüfung abschalten (nur Notlösung in vertrauenswürdigen Netzen).
    tlsCaPath: process.env.LDAP_TLS_CA_PFAD || '',
    tlsRejectUnauthorized:
      String(process.env.LDAP_TLS_REJECT_UNAUTHORIZED || '').toLowerCase() !== 'false',
  },
};

// Harte Anforderungen prüfen – lieber früh und deutlich abbrechen.
function validate() {
  const errors = [];
  if (!config.masterKey) {
    errors.push('MASTER_KEY fehlt. Erzeugen mit: openssl rand -base64 32');
  } else {
    try {
      const raw = Buffer.from(config.masterKey, 'base64');
      if (raw.length < 32) {
        errors.push('MASTER_KEY ist zu kurz (mindestens 32 Byte / base64 von 32 Byte nötig).');
      }
    } catch {
      errors.push('MASTER_KEY ist kein gültiges base64.');
    }
  }
  if (!config.sessionSecret) {
    errors.push('SESSION_SECRET fehlt. Erzeugen mit: openssl rand -base64 32');
  }
  if (config.authMode === 'ldap') {
    if (!config.ldap.url) errors.push('AUTH_MODE=ldap, aber LDAP_URL fehlt.');
    if (!config.ldap.baseDn) errors.push('AUTH_MODE=ldap, aber LDAP_BASE_DN fehlt.');
    // Ohne Direkt-Bind-Vorlage läuft der Service-Account-Modus -> Lese-Konto Pflicht.
    if (!config.ldap.userBindTemplate) {
      if (!config.ldap.bindDn) {
        errors.push(
          'AUTH_MODE=ldap im Service-Account-Modus, aber LDAP_BIND_DN fehlt ' +
            '(oder LDAP_BIND_USER_TEMPLATE für den Direkt-Bind setzen).'
        );
      }
      if (!config.ldap.bindPw) {
        errors.push(
          'AUTH_MODE=ldap im Service-Account-Modus, aber LDAP_BIND_PW fehlt ' +
            '(oder LDAP_BIND_USER_TEMPLATE für den Direkt-Bind setzen).'
        );
      }
    }
    if (config.ldap.tlsCaPath && !fs.existsSync(config.ldap.tlsCaPath)) {
      errors.push(`LDAP_TLS_CA_PFAD zeigt auf keine existierende Datei: ${config.ldap.tlsCaPath}`);
    }
  } else if (config.authMode !== 'dev') {
    errors.push(`Unbekannter AUTH_MODE "${config.authMode}" (erlaubt: dev, ldap).`);
  }

  // Cross-site-Embedding verlangt SameSite=None -> nur mit Secure-Cookie zulässig
  // (Browser lehnen SameSite=None ohne Secure ab). Origins grob prüfen.
  if (config.embedAncestors.length) {
    if (!config.secureCookies) {
      errors.push(
        'EMBED_ANCESTORS gesetzt, aber SECURE_COOKIES ist nicht true. ' +
          'Cross-site-Embedding braucht SameSite=None;Secure -> SECURE_COOKIES=true setzen (HTTPS nötig).'
      );
    }
    for (const o of config.embedAncestors) {
      if (!/^https?:\/\/[^/]+$/.test(o)) {
        errors.push(
          `EMBED_ANCESTORS-Eintrag "${o}" ist keine gültige Origin ` +
            '(erwartet z. B. "https://cloud.schule.de", ohne Pfad/Slash am Ende).'
        );
      }
    }
  }

  if (errors.length) {
    console.error('\nKonfigurationsfehler:\n  - ' + errors.join('\n  - ') + '\n');
    console.error('Siehe .env.example. Kopiere sie nach .env und fülle die Werte aus.\n');
    process.exit(1);
  }
}

module.exports = { config, validate };
