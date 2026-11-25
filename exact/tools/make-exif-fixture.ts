// Writes fixtures/photo-with-exif.jpg: a placeholder photo carrying EXIF a
// phone would write (taken 2026-05-04 08:30, at 37.77, -122.28, ±12 m), for
// the new-observation tests. `bun tools/make-exif-fixture.ts` (macOS: uses sips).
import { readExif } from '../exif.ts';

const dir = `${import.meta.dir}/..`;
const plain = `${dir}/.exact/photo-plain.jpg`;
await Bun.$`mkdir -p ${dir}/.exact && sips -s format jpeg -s formatOptions 70 ${dir}/assets/photos/redeft.png --out ${plain}`.quiet();
const jpeg = new Uint8Array(await Bun.file(plain).arrayBuffer());

// A big-endian TIFF: IFD0 → Exif IFD (DateTimeOriginal) and GPS IFD.
const out: number[] = [];
const u16 = (n: number) => out.push((n >> 8) & 0xff, n & 0xff);
const u32 = (n: number) => out.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
const at = (offset: number, n: number) => { out[offset] = (n >>> 24) & 0xff; out[offset + 1] = (n >>> 16) & 0xff; out[offset + 2] = (n >>> 8) & 0xff; out[offset + 3] = n & 0xff; };
const entry = (tag: number, type: number, count: number) => { u16(tag); u16(type); u32(count); const slot = out.length; u32(0); return slot; };
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
const rational = (num: number, den: number) => { u32(num); u32(den); };

out.push(0x4d, 0x4d); u16(42); u32(8);
// IFD0: two pointers
u16(2);
const exifPtr = entry(0x8769, 4, 1);
const gpsPtr = entry(0x8825, 4, 1);
u32(0);
// Exif IFD: DateTimeOriginal
at(exifPtr, out.length);
const date = ascii('2026:05:04 08:30:00');
u16(1);
const dateSlot = entry(0x9003, 2, date.length);
u32(0);
at(dateSlot, out.length); out.push(...date);
// GPS IFD: 37° 46' 12" N, 122° 16' 48" W, ±12 m
at(gpsPtr, out.length);
u16(5);
const latRef = entry(0x0001, 2, 2);
const lat = entry(0x0002, 5, 3);
const lngRef = entry(0x0003, 2, 2);
const lng = entry(0x0004, 5, 3);
const err = entry(0x001f, 5, 1);
u32(0);
out[latRef] = 'N'.charCodeAt(0); out[latRef + 1] = 0;
out[lngRef] = 'W'.charCodeAt(0); out[lngRef + 1] = 0;
at(lat, out.length); rational(37, 1); rational(46, 1); rational(12, 1);
at(lng, out.length); rational(122, 1); rational(16, 1); rational(48, 1);
at(err, out.length); rational(12, 1);

const app1Body = [...ascii('Exif'), 0, ...out];
const app1 = [0xff, 0xe1, ((app1Body.length + 2) >> 8) & 0xff, (app1Body.length + 2) & 0xff, ...app1Body];
const result = new Uint8Array([...jpeg.slice(0, 2), ...app1, ...jpeg.slice(2)]);
await Bun.write(`${dir}/fixtures/photo-with-exif.jpg`, result);
console.log('fixtures/photo-with-exif.jpg', result.length, 'bytes', readExif(result));
