/**
 * Minimal ICO writer.
 *
 * Emits a PNG-in-ICO container (each directory entry points at a complete PNG
 * payload). Supported by every browser in use today and by Windows Vista+.
 */
export function buildIco(pngs: { size: number; data: Buffer }[]): Buffer {
  const entries = [...pngs].sort((a, b) => a.size - b.size);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;

  entries.forEach((entry, i) => {
    const at = i * 16;
    // 256px is encoded as 0.
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 0);
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    dir.writeUInt8(0, at + 2); // palette colors
    dir.writeUInt8(0, at + 3); // reserved
    dir.writeUInt16LE(1, at + 4); // color planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(entry.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}
