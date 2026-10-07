import { readFileSync } from 'node:fs';
const expected = JSON.parse(readFileSync(new URL('./public-schema.json', import.meta.url), 'utf8'));
export async function verifyPublicSchema(db) {
  const columns = await db.manyOrNone(
    'SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1',
    ['public']);
  const actual = new Set(columns.map(c => `${c.table_name}.${c.column_name}`));
  for (const [table, names] of Object.entries(expected)) {
    for (const name of names) if (!actual.has(`${table}.${name}`)) throw Object.assign(new Error('Required public schema does not match the reviewed metadata'), { code: 'SCHEMA_MISMATCH' });
  }
}
