// Builds a tiny JPEG whose only content is an EXIF block, for tests that need
// a photo with a known capture time and position. It is not a decodable image.

interface Entry {
  tag: number;
  type: 2 | 4 | 5; // ASCII, LONG, RATIONAL
  count: number;
  value: Buffer;
}

const ascii = (tag: number, text: string): Entry => {
  const value = Buffer.from(`${text}\0`, "ascii");
  return { tag, type: 2, count: value.length, value };
};

const long = (tag: number, n: number): Entry => {
  const value = Buffer.alloc(4);
  value.writeUInt32LE(n);
  return { tag, type: 4, count: 1, value };
};

const rationals = (tag: number, pairs: Array<[number, number]>): Entry => {
  const value = Buffer.alloc(pairs.length * 8);
  pairs.forEach(([numerator, denominator], i) => {
    value.writeUInt32LE(numerator, i * 8);
    value.writeUInt32LE(denominator, i * 8 + 4);
  });
  return { tag, type: 5, count: pairs.length, value };
};

/** Serialize one IFD placed at `offset`; values over 4 bytes follow the entry table. */
function ifd(entries: Entry[], offset: number): Buffer {
  const table = Buffer.alloc(2 + entries.length * 12 + 4);
  table.writeUInt16LE(entries.length, 0);
  const extras: Buffer[] = [];
  let extraOffset = offset + table.length;
  entries.forEach((entry, i) => {
    const at = 2 + i * 12;
    table.writeUInt16LE(entry.tag, at);
    table.writeUInt16LE(entry.type, at + 2);
    table.writeUInt32LE(entry.count, at + 4);
    if (entry.value.length <= 4) {
      entry.value.copy(table, at + 8);
    } else {
      table.writeUInt32LE(extraOffset, at + 8);
      // IFD values must start on a word boundary.
      const padded = Buffer.concat([entry.value, Buffer.alloc(entry.value.length % 2)]);
      extras.push(padded);
      extraOffset += padded.length;
    }
  });
  return Buffer.concat([table, ...extras]);
}

/** Degrees as the degree/minute/second rationals EXIF stores. */
function dms(degrees: number): Array<[number, number]> {
  const abs = Math.abs(degrees);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = Math.round(((abs - d) * 60 - m) * 60 * 1000);
  return [
    [d, 1],
    [m, 1],
    [s, 1000],
  ];
}

export interface ExifJpegOptions {
  /** `YYYY:MM:DD HH:MM:SS`, as EXIF writes it. */
  dateTimeOriginal: string;
  /** e.g. "-07:00" */
  offsetTimeOriginal: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

export function exifJpeg(options: ExifJpegOptions): Buffer {
  const exifEntries = [
    ascii(0x9003, options.dateTimeOriginal),
    ascii(0x9011, options.offsetTimeOriginal),
  ];
  const gpsEntries = [
    ascii(0x0001, options.latitude < 0 ? "S" : "N"),
    rationals(0x0002, dms(options.latitude)),
    ascii(0x0003, options.longitude < 0 ? "W" : "E"),
    rationals(0x0004, dms(options.longitude)),
    rationals(0x001f, [[options.accuracyMeters, 1]]),
  ];

  const ifd0Offset = 8;
  const exifOffset = ifd0Offset + 2 + 2 * 12 + 4;
  const exifIfd = ifd(exifEntries, exifOffset);
  const gpsOffset = exifOffset + exifIfd.length;
  const ifd0 = ifd([long(0x8769, exifOffset), long(0x8825, gpsOffset)], ifd0Offset);

  const tiffHeader = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
  const tiff = Buffer.concat([tiffHeader, ifd0, exifIfd, ifd(gpsEntries, gpsOffset)]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, payload, Buffer.from([0xff, 0xd9])]);
}
