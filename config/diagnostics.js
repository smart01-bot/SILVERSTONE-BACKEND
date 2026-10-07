// Only fixed categories and allowlisted codes are returned. Never return driver
// messages, queries, parameters, connection objects, URLs or credential values.
const categories = {
  '28P01': 'DATABASE_AUTHENTICATION_FAILED',
  '28000': 'DATABASE_AUTHENTICATION_FAILED',
  '3D000': 'DATABASE_NOT_FOUND',
  '42501': 'DATABASE_PERMISSION_DENIED',
  '53300': 'DATABASE_CONNECTION_LIMIT',
  '57P03': 'DATABASE_UNAVAILABLE',
  '42P01': 'DATABASE_SCHEMA_MISMATCH',
  SCHEMA_MISMATCH: 'DATABASE_SCHEMA_MISMATCH',
  CERT_HAS_EXPIRED: 'TLS_CERTIFICATE_EXPIRED',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS_CA_TRUST_FAILED',
  SELF_SIGNED_CERT_IN_CHAIN: 'TLS_CA_TRUST_FAILED',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS_CA_TRUST_FAILED',
  UNABLE_TO_GET_ISSUER_CERT: 'TLS_CA_TRUST_FAILED',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'TLS_CA_TRUST_FAILED',
  ERR_TLS_CERT_ALTNAME_INVALID: 'TLS_HOSTNAME_MISMATCH',
  ECONNREFUSED: 'NETWORK_CONNECTION_REFUSED',
  ETIMEDOUT: 'NETWORK_TIMEOUT',
  EHOSTUNREACH: 'NETWORK_UNREACHABLE',
  ENETUNREACH: 'NETWORK_UNREACHABLE',
  ECONNRESET: 'NETWORK_CONNECTION_RESET',
  ENOTFOUND: 'DNS_LOOKUP_FAILED',
  EAI_AGAIN: 'DNS_LOOKUP_FAILED',
  MISSING_JWT_SECRET: 'MISSING_JWT_SECRET',
  LEGACY_WORKER_DISABLED: 'LEGACY_WORKER_DISABLED',
};
export function safeDiagnostic(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (Object.hasOwn(categories, code)) return { category: categories[code], code };
  if (error?.message === 'Connection terminated due to connection timeout' || error?.message === 'Query read timeout') {
    return { category: 'NETWORK_TIMEOUT', code: 'TIMEOUT' };
  }
  if (error?.message === 'The server does not support SSL connections') {
    return { category: 'TLS_UNAVAILABLE', code: 'TLS_UNAVAILABLE' };
  }
  return { category: 'UNCLASSIFIED_STARTUP_FAILURE', code: 'UNKNOWN' };
}
