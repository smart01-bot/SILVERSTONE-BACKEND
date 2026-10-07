import { newDb } from 'pg-mem';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcrypt';

const memory = newDb();
memory.public.registerFunction({ name: 'gen_random_uuid', returns: 'uuid', implementation: randomUUID, impure: true });
const metadata = JSON.parse(readFileSync(new URL('../fixtures/public-schema-metadata.json', import.meta.url), 'utf8'));
for (const table of metadata) {
  const columns = table.columns.map(c => `${c.name} ${c.type}${c.nullable ? '' : ' NOT NULL'}${c.default ? ` DEFAULT ${c.default}` : ''}${c.unique ? ' UNIQUE' : ''}${c.check ? ` CHECK (${c.check})` : ''}`);
  columns.push(`PRIMARY KEY (${table.primary_key.join(',')})`);
  for (const fk of table.foreign_keys) columns.push(`FOREIGN KEY (${fk.source_columns.join(',')}) REFERENCES ${fk.target_table} (${fk.target_columns.join(',')})`);
  memory.public.none(`CREATE TABLE ${table.table} (${columns.join(',')});`);
}
const snapshot = memory.backup();
export const db = memory.adapters.createPgPromise();
export const redis = {
  isOpen: false,
  async connect() { this.isOpen = true; },
  async ping() { return 'PONG'; },
  withCommandOptions() { return this; },
  async quit() { this.isOpen = false; },
};
export function resetServices() { snapshot.restore(); }
export async function seedAgent({ role = 'sub-agent', status = 'approved', phone = randomUUID(), pin = '123456' } = {}) {
  return db.one('INSERT INTO public.agents (role, status, phone_number, pin_hash, full_name, agent_nin) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [role, status, phone, await bcrypt.hash(pin, 4), 'Synthetic Agent', randomUUID()]);
}
export async function seedNetworks() {
  const from = await db.one("INSERT INTO public.networks (name,code) VALUES ('Vodacom','vodacom') RETURNING *");
  const to = await db.one("INSERT INTO public.networks (name,code) VALUES ('Airtel','airtel') RETURNING *");
  return { from, to };
}
