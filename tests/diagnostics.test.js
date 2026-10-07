import { safeDiagnostic } from '../config/diagnostics.js';
it.each([
  ['28P01', 'DATABASE_AUTHENTICATION_FAILED'],
  ['SELF_SIGNED_CERT_IN_CHAIN', 'TLS_CA_TRUST_FAILED'],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'TLS_HOSTNAME_MISMATCH'],
  ['ENETUNREACH', 'NETWORK_UNREACHABLE'],
  ['SCHEMA_MISMATCH', 'DATABASE_SCHEMA_MISMATCH'],
  ['42501', 'DATABASE_PERMISSION_DENIED'],
])('classifies %s without exposing driver messages', (code, category) => {
  const diagnostic = safeDiagnostic({ code, message: 'private-url-password', connection: 'private-url-password', query: 'private-query' });
  expect(diagnostic).toEqual({ category, code });
  expect(JSON.stringify(diagnostic)).not.toContain('private');
});
it('never logs an arbitrary error code, message or credentials', () => {
  expect(safeDiagnostic({ code: 'private-secret', message: 'private-url-password' }))
    .toEqual({ category: 'UNCLASSIFIED_STARTUP_FAILURE', code: 'UNKNOWN' });
});
