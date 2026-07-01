'use strict';

// LDAP-Authentifizierung per einfachem Bind.
// Aktiv nur bei AUTH_MODE=ldap. Parameter kommen aus der .env, damit der
// Kollege das Setup ohne Code-Änderung scharfschalten kann.

const { config } = require('../config');

// Prüft Username/Passwort gegen den LDAP-Server via Bind.
// Gibt bei Erfolg { username } zurück, sonst wirft es einen Fehler.
async function authenticate(username, password) {
  if (!username || !password) {
    const e = new Error('Username und Passwort erforderlich');
    e.status = 400;
    throw e;
  }

  // ldapjs erst hier laden, damit die App im dev-Modus ohne installiertes/nutzbares
  // LDAP läuft (das Modul ist zwar Dependency, der Bind aber optional).
  const ldap = require('ldapjs');

  const bindDn = config.ldap.bindDnTemplate.replace(
    '{username}',
    escapeDn(username.trim())
  );

  return new Promise((resolve, reject) => {
    const client = ldap.createClient({
      url: config.ldap.url,
      tlsOptions: config.ldap.tls ? {} : undefined,
      timeout: 5000,
      connectTimeout: 5000,
    });

    client.on('error', (err) => {
      safeUnbind(client);
      reject(wrapAuthError(err));
    });

    client.bind(bindDn, password, (err) => {
      safeUnbind(client);
      if (err) return reject(wrapAuthError(err));
      resolve({ username: username.trim().toLowerCase() });
    });
  });
}

function escapeDn(v) {
  // Minimales DN-Escaping gegen Injection in die Bind-DN.
  return String(v).replace(/([\\,+"<>;=])/g, '\\$1');
}

function safeUnbind(client) {
  try {
    client.unbind(() => {});
  } catch {
    /* ignore */
  }
}

function wrapAuthError(err) {
  const e = new Error('LDAP-Anmeldung fehlgeschlagen');
  // InvalidCredentials -> 401, alles andere (Netz/Config) -> 502
  e.status = err && /invalidcredentials/i.test(err.name || '') ? 401 : 502;
  e.cause = err;
  return e;
}

module.exports = { authenticate };
