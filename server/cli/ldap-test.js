'use strict';

// Diagnose-CLI: testet den LDAP-Login direkt (ohne Webserver) und gibt die
// verwendete Konfiguration sowie den vollständigen Fehler aus. Liest dieselbe
// .env wie der Server.
//
// Aufruf:  AUTH_MODE=ldap npm run ldap-test -- <benutzername> <passwort>
//   bzw.   AUTH_MODE=ldap node server/cli/ldap-test.js <benutzername> <passwort>

const { config } = require('../config');
const ldap = require('../auth/ldap');

const benutzer = process.argv[2];
const passwort = process.argv[3];
if (!benutzer || !passwort) {
  console.error('Aufruf: npm run ldap-test -- <benutzername> <passwort>');
  process.exit(2);
}

async function main() {
  console.log('LDAP-Konfiguration:');
  console.log('  URL        :', config.ldap.url || '(fehlt)');
  console.log('  baseDn     :', config.ldap.baseDn || '(fehlt)');
  console.log(
    '  Modus      :',
    config.ldap.userBindTemplate
      ? `Direkt-Bind (${config.ldap.userBindTemplate})`
      : `Service-Account (${config.ldap.bindDn || 'LDAP_BIND_DN fehlt'})`
  );
  console.log('  userFilter :', config.ldap.userFilter.replace('{{username}}', benutzer));
  console.log('  loginAttr  :', config.ldap.loginAttr);
  console.log(
    '  TLS        :',
    config.ldap.tlsCaPath
      ? `CA=${config.ldap.tlsCaPath}, rejectUnauthorized=${config.ldap.tlsRejectUnauthorized}`
      : `rejectUnauthorized=${config.ldap.tlsRejectUnauthorized}`
  );
  console.log();

  if (config.authMode !== 'ldap') {
    console.log('Hinweis: AUTH_MODE ist nicht "ldap" — setze AUTH_MODE=ldap für einen echten Test.\n');
  }

  try {
    const erg = await ldap.authenticate(benutzer, passwort);
    if (erg) {
      console.log('✅ Anmeldung erfolgreich:', erg);
      console.log(
        `\nHinweis: Die Nutzer-DB wird aus login_sub = "${erg.loginSub}" abgeleitet (klein geschrieben).`
      );
    } else {
      console.log(
        '⚠️  Anmeldung abgelehnt: Benutzer nicht gefunden, mehrdeutig oder Passwort falsch (kein technischer Fehler).'
      );
    }
  } catch (e) {
    console.error('❌ Technischer Fehler beim LDAP-Zugriff:');
    const ursache = e && e.cause ? e.cause : e;
    if (ursache && ursache.code) console.error('  code   :', ursache.code);
    if (ursache && ursache.message) console.error('  message:', ursache.message);
    console.error(ursache);
    process.exitCode = 1;
  }
}

main();
