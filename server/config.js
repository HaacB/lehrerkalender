'use strict';

// Lädt und validiert die Umgebungskonfiguration aus .env
require('dotenv').config();

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
  authMode: AUTH_MODE,
  devAllowedUsers: (process.env.DEV_ALLOWED_USERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  ldap: {
    url: process.env.LDAP_URL || '',
    bindDnTemplate: process.env.LDAP_BIND_DN_TEMPLATE || '',
    tls: bool(process.env.LDAP_TLS, false),
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
    if (!config.ldap.bindDnTemplate) errors.push('AUTH_MODE=ldap, aber LDAP_BIND_DN_TEMPLATE fehlt.');
  } else if (config.authMode !== 'dev') {
    errors.push(`Unbekannter AUTH_MODE "${config.authMode}" (erlaubt: dev, ldap).`);
  }

  if (errors.length) {
    console.error('\nKonfigurationsfehler:\n  - ' + errors.join('\n  - ') + '\n');
    console.error('Siehe .env.example. Kopiere sie nach .env und fülle die Werte aus.\n');
    process.exit(1);
  }
}

module.exports = { config, validate };
