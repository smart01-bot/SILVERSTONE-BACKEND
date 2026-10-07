import { Client } from 'pg';
import { databaseOptions } from '../config/databaseOptions.js';

it.each(['disable', 'no-verify', 'require', 'prefer', 'verify-full'])(
  'keeps pg certificate verification on when URL has sslmode=%s', mode => {
    const options = databaseOptions({ DATABASE_URL: `postgres://test:test@localhost/test?sslmode=${mode}` });
    const client = new Client(options);
    expect(client.connectionParameters.ssl.rejectUnauthorized).toBe(true);
  }
);

it('fails clearly when DATABASE_URL is missing', () => {
  expect(() => databaseOptions({})).toThrow('DATABASE_URL environment variable is not set');
});

it('fails closed when the configured CA file cannot be read', () => {
  expect(() => databaseOptions({
    DATABASE_URL: 'postgres://test:test@localhost/test',
    DATABASE_SSL_CA_FILE: '/nonexistent/silverstone-ca.pem',
  })).toThrow();
});

it('does not echo malformed connection credentials in errors', () => {
  expect(() => databaseOptions({ DATABASE_URL: 'invalid-sensitive-input' })).toThrow('DATABASE_URL must be a valid PostgreSQL URL');
});
