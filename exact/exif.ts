// Reads what a new observation can take from its photo's EXIF: when it was
// taken and where. JPEG only (an iPhone's HEIC is converted to JPEG first,
// keeping its EXIF). No dependency: Exact's data module runs pure code.

export type PhotoExif = {
  // "YYYY-MM-DDTHH:mm", the camera's own clock, as an <input type="datetime-local"> holds it.
  takenAt: string;
  // The UTC offset that clock was in ("-07:00"), when the camera wrote one; else "".
  offset: string;
  latitude: number | null;
  longitude: number | null;
  // Metres, from GPSHPositioningError when the camera wrote one.
  uncertainty: number | null;
};

const NONE: PhotoExif = { takenAt: '', offset: '', latitude: null, longitude: null, uncertainty: null };

const TAG = {
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  dateTimeOriginal: 0x9003,
  dateTime: 0x0132,
  offsetTimeOriginal: 0x9011,
  offsetTime: 0x9010,
  latRef: 0x0001,
  lat: 0x0002,
  lngRef: 0x0003,
  lng: 0x0004,
  hError: 0x001f,
} as const;

/** The EXIF facts in a JPEG's bytes; empty fields where it has none. */
export function readExif(bytes: Uint8Array): PhotoExif {
  try {
    const tiff = exifSegment(bytes);
    return tiff ? fromTiff(tiff) : NONE;
  } catch {
    return NONE;
  }
}

// The TIFF block inside the JPEG's APP1 "Exif\0\0" segment.
function exifSegment(b: Uint8Array): DataView | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    if (marker === 0xda || marker === 0xd9) return null; // image data: no EXIF before it
    const size = (b[at + 2] << 8) | b[at + 3];
    if (marker === 0xe1 && b[at + 4] === 0x45 && b[at + 5] === 0x78 && b[at + 6] === 0x69 && b[at + 7] === 0x66) {
      return new DataView(b.buffer, b.byteOffset + at + 10, size - 8);
    }
    at += 2 + size;
  }
  return null;
}

type Entry = { type: number; count: number; valueAt: number };

function fromTiff(v: DataView): PhotoExif {
  const little = v.getUint16(0) === 0x4949;
  const u16 = (o: number) => v.getUint16(o, little);
  const u32 = (o: number) => v.getUint32(o, little);
  const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  const ifd = (offset: number): Map<number, Entry> => {
    const entries = new Map<number, Entry>();
    if (!offset || offset + 2 > v.byteLength) return entries;
    const n = u16(offset);
    for (let i = 0; i < n; i++) {
      const e = offset + 2 + i * 12;
      const type = u16(e + 2);
      const count = u32(e + 4);
      const inline = (SIZES[type] ?? 1) * count <= 4;
      entries.set(u16(e), { type, count, valueAt: inline ? e + 8 : u32(e + 8) });
    }
    return entries;
  };
  const ascii = (e?: Entry) => {
    if (!e) return '';
    let s = '';
    for (let i = 0; i < e.count; i++) {
      const c = v.getUint8(e.valueAt + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const rationals = (e?: Entry) => {
    if (!e || e.type !== 5) return [];
    return Array.from({ length: e.count }, (_, i) => {
      const den = u32(e.valueAt + i * 8 + 4);
      return den ? u32(e.valueAt + i * 8) / den : NaN;
    });
  };
  const pointer = (e?: Entry) => (e ? u32(e.valueAt) : 0);

  const ifd0 = ifd(u32(4));
  const exif = ifd(pointer(ifd0.get(TAG.exifIfd)));
  const gps = ifd(pointer(ifd0.get(TAG.gpsIfd)));

  // "2026:05:04 08:30:00" → "2026-05-04T08:30"
  const stamp = ascii(exif.get(TAG.dateTimeOriginal)) || ascii(ifd0.get(TAG.dateTime));
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(stamp);
  const takenAt = m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : '';
  // OffsetTime goes with DateTime, so it only stands in for the original's when that's missing too.
  const zone = (ascii(exif.get(TAG.offsetTimeOriginal)) || (ascii(exif.get(TAG.dateTimeOriginal)) ? '' : ascii(exif.get(TAG.offsetTime)))).trim();
  const offset = takenAt && /^[+-]\d{2}:\d{2}$/.test(zone) ? zone : '';

  const degrees = (parts: number[], ref: string) => {
    if (parts.length < 3 || parts.some((p) => !Number.isFinite(p))) return null;
    const d = parts[0] + parts[1] / 60 + parts[2] / 3600;
    return ref === 'S' || ref === 'W' ? -d : d;
  };
  const latitude = degrees(rationals(gps.get(TAG.lat)), ascii(gps.get(TAG.latRef)));
  const longitude = degrees(rationals(gps.get(TAG.lng)), ascii(gps.get(TAG.lngRef)));
  const err = rationals(gps.get(TAG.hError))[0];
  const placed = latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  return {
    takenAt,
    offset,
    latitude: placed ? latitude : null,
    longitude: placed ? longitude : null,
    uncertainty: placed && Number.isFinite(err) ? Math.round(err) : null,
  };
}
