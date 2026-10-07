// Test-only encrypted snapshot transport. No environment reads, network or default path.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
const magic = Buffer.from("SS6BACK1");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function keyCheck(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw new Error("An explicit 32-byte backup key is required.");
}
export function encryptBackup(bytes, key, metadata) {
  keyCheck(key);
  const manifest = Buffer.from(
    JSON.stringify({
      ...metadata,
      format: 1,
      scope: "synthetic_local",
      sha256: digest(bytes),
    }),
  );
  if (manifest.length > 65536) throw new Error("Backup manifest too large.");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(manifest.length);
  const aad = Buffer.concat([magic, size, manifest]),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([aad, iv, cipher.getAuthTag(), ciphertext]);
}
export function decryptBackup(archive, key) {
  keyCheck(key);
  if (
    !Buffer.isBuffer(archive) ||
    archive.length < 40 ||
    !archive.subarray(0, 8).equals(magic)
  )
    throw new Error("Invalid backup archive.");
  const size = archive.readUInt32BE(8),
    offset = 12 + size;
  if (size > 65536 || archive.length <= offset + 28)
    throw new Error("Invalid backup archive.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    archive.subarray(offset, offset + 12),
  );
  decipher.setAAD(archive.subarray(0, offset));
  decipher.setAuthTag(archive.subarray(offset + 12, offset + 28));
  let bytes, manifest;
  try {
    bytes = Buffer.concat([
      decipher.update(archive.subarray(offset + 28)),
      decipher.final(),
    ]);
    manifest = JSON.parse(archive.subarray(12, offset));
  } catch {
    throw new Error("Backup authentication failed; nothing restored.");
  }
  if (
    manifest.format !== 1 ||
    manifest.scope !== "synthetic_local" ||
    manifest.sha256 !== digest(bytes)
  )
    throw new Error("Backup integrity check failed.");
  return { bytes, manifest };
}
export async function embeddedBackup(db, key) {
  if (db.syntheticOnly !== true)
    throw new Error("Only explicitly synthetic local snapshots are supported.");
  const migrations = (
    await db.query(
      "SELECT name,checksum FROM ss_v1.schema_migrations ORDER BY name",
    )
  ).rows;
  const bytes = Buffer.from(await (await db.snapshot()).arrayBuffer());
  return encryptBackup(bytes, key, { engine: "pglite", migrations });
}
