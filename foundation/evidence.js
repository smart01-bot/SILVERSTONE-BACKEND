import { inflateSync } from "node:zlib";
import { invalid } from "./errors.js";
const bad = () =>
  invalid("Choose a valid PNG or JPEG up to 2 MB and 16 million pixels.");
function dimensions(w, h) {
  if (!w || !h || w * h > 16000000) throw bad();
}
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
export function validateEvidence(bytes, mime) {
  if (!bytes.length || bytes.length > 2097152) throw bad();
  if (mime === "image/png") {
    if (
      bytes.length < 45 ||
      !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    )
      throw bad();
    let pos = 8,
      header = false,
      end = false;
    const data = [];
    while (pos < bytes.length) {
      if (pos + 12 > bytes.length) throw bad();
      const size = bytes.readUInt32BE(pos),
        type = bytes.subarray(pos + 4, pos + 8).toString();
      if (size > 2097152 || pos + 12 + size > bytes.length) throw bad();
      if (
        crc32(bytes.subarray(pos + 4, pos + 8 + size)) !==
        bytes.readUInt32BE(pos + 8 + size)
      )
        throw bad();
      if (!header) {
        if (type !== "IHDR" || size !== 13) throw bad();
        dimensions(bytes.readUInt32BE(pos + 8), bytes.readUInt32BE(pos + 12));
        header = true;
      } else if (type === "IHDR") throw bad();
      if (type === "IDAT") data.push(bytes.subarray(pos + 8, pos + 8 + size));
      pos += size + 12;
      if (type === "IEND") {
        if (size !== 0 || pos !== bytes.length) throw bad();
        end = true;
        break;
      }
    }
    if (!end || !data.length) throw bad();
    try {
      inflateSync(Buffer.concat(data), { maxOutputLength: 64 * 1024 * 1024 });
    } catch {
      throw bad();
    }
    return;
  }
  if (mime === "image/jpeg") {
    if (
      bytes.length < 20 ||
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes.at(-2) !== 255 ||
      bytes.at(-1) !== 217
    )
      throw bad();
    let pos = 2,
      found = false;
    while (pos < bytes.length - 2) {
      if (bytes[pos++] !== 255) throw bad();
      while (bytes[pos] === 255) pos++;
      const marker = bytes[pos++];
      if (marker === 0xda) {
        if (!found) throw bad();
        return;
      }
      if (pos + 2 > bytes.length) throw bad();
      const size = bytes.readUInt16BE(pos);
      if (size < 2 || pos + size > bytes.length) throw bad();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (size < 8) throw bad();
        dimensions(bytes.readUInt16BE(pos + 5), bytes.readUInt16BE(pos + 3));
        found = true;
      }
      pos += size;
    }
  }
  throw bad();
}
