// Sample rows in the shape observ.ing's appview returns from GET /api/feeds/explore
// (frontend/src/bindings/Occurrence.ts). Names follow real species; photos are
// generated placeholders under assets/photos. server.ts serves these; app.ts can
// also answer from them directly (DEMO) for a build with no server.

export type Profile = { did: string; handle?: string; displayName?: string; avatar?: string };
export type Occurrence = {
  uri: string;
  cid: string;
  observer: Profile;
  effectiveTaxonomy?: {
    scientificName: string;
    vernacularName?: string;
    rank?: string;
    kingdom?: string;
    phylum?: string;
    class?: string;
    order?: string;
    family?: string;
    genus?: string;
  };
  identificationCount: number;
  eventDate?: string;
  location?: { latitude: number; longitude: number; uncertaintyMeters?: number };
  occurrenceRemarks?: string;
  images: { url: string; license?: string }[];
  externalRecords: { uri: string; service?: string }[];
  createdAt: string;
  likeCount?: number;
  viewerHasLiked?: boolean;
  qualityIssues: string[];
};

const alice: Profile = { did: 'did:plc:alice', handle: 'alice.bsky.social', displayName: 'Alice Botanist' };
const bob: Profile = { did: 'did:plc:bob', handle: 'bob.bsky.social', displayName: 'Bob Naturalist' };
const kim: Profile = { did: 'did:plc:kim', handle: 'kim.observ.ing' };

const photo = (name: string) => [{ url: `/photos/${name}.png`, license: 'CC-BY-4.0' }];

export const OCCURRENCES: Occurrence[] = [
  {
    uri: 'at://did:plc:alice/app.observ.occurrence/cardinal1', cid: 'bafycardinal1', observer: alice,
    effectiveTaxonomy: { scientificName: 'Cardinalis cardinalis', vernacularName: 'Northern Cardinal', rank: 'species',
      kingdom: 'Animalia', phylum: 'Chordata', class: 'Aves', order: 'Passeriformes', family: 'Cardinalidae', genus: 'Cardinalis' },
    identificationCount: 3, eventDate: '2026-11-08T08:12:00Z',
    location: { latitude: 41.9248, longitude: -74.0646, uncertaintyMeters: 15 },
    occurrenceRemarks: 'Male at the feeder, calling from the lilac after.',
    images: photo('cardinal'), externalRecords: [], createdAt: '2026-11-08T08:20:00Z', likeCount: 4, qualityIssues: [],
  },
  {
    uri: 'at://did:plc:bob/app.observ.occurrence/amanita1', cid: 'bafyamanita1', observer: bob,
    effectiveTaxonomy: { scientificName: 'Amanita muscaria', vernacularName: 'Fly Agaric', rank: 'species',
      kingdom: 'Fungi', phylum: 'Basidiomycota', class: 'Agaricomycetes', order: 'Agaricales', family: 'Amanitaceae', genus: 'Amanita' },
    identificationCount: 2, eventDate: '2026-11-06T15:40:00Z',
    location: { latitude: 41.9301, longitude: -74.1012, uncertaintyMeters: 30 },
    images: photo('amanita'), externalRecords: [{ uri: 'https://www.inaturalist.org/observations/123456789', service: 'inaturalist' }],
    createdAt: '2026-11-06T16:02:00Z', likeCount: 9, qualityIssues: [],
  },
  {
    uri: 'at://did:plc:kim/app.observ.occurrence/eft1', cid: 'bafyeft1', observer: kim,
    effectiveTaxonomy: { scientificName: 'Notophthalmus viridescens', vernacularName: 'Eastern Newt', rank: 'species',
      kingdom: 'Animalia', phylum: 'Chordata', class: 'Amphibia', order: 'Caudata', family: 'Salamandridae', genus: 'Notophthalmus' },
    identificationCount: 1, eventDate: '2026-11-02T13:05:00Z',
    location: { latitude: 41.9612, longitude: -74.2203, uncertaintyMeters: 120 },
    occurrenceRemarks: 'Red eft stage, crossing the trail after rain.',
    images: photo('redeft'), externalRecords: [], createdAt: '2026-11-02T14:00:00Z', likeCount: 2, qualityIssues: [],
  },
  {
    uri: 'at://did:plc:alice/app.observ.occurrence/oak1', cid: 'bafyoak1', observer: alice,
    effectiveTaxonomy: { scientificName: 'Quercus robur', vernacularName: 'English Oak', rank: 'species',
      kingdom: 'Plantae', phylum: 'Tracheophyta', class: 'Magnoliopsida', order: 'Fagales', family: 'Fagaceae', genus: 'Quercus' },
    identificationCount: 2, eventDate: '2026-10-28T10:30:00Z',
    location: { latitude: 51.5074, longitude: -0.1278, uncertaintyMeters: 25 },
    images: photo('oak'), externalRecords: [], createdAt: '2026-10-28T10:35:00Z', likeCount: 3, qualityIssues: [],
  },
  {
    uri: 'at://did:plc:bob/app.observ.occurrence/monarch1', cid: 'bafymonarch1', observer: bob,
    effectiveTaxonomy: { scientificName: 'Danaus plexippus', vernacularName: 'Monarch', rank: 'species',
      kingdom: 'Animalia', phylum: 'Arthropoda', class: 'Insecta', order: 'Lepidoptera', family: 'Nymphalidae', genus: 'Danaus' },
    identificationCount: 1, eventDate: '2026-09-21T17:00:00Z',
    location: { latitude: 41.7004, longitude: -73.9210, uncertaintyMeters: 4000 },
    images: photo('monarch'), externalRecords: [], createdAt: '2026-09-21T18:10:00Z', likeCount: 12,
    qualityIssues: ['COORDINATES_IMPRECISE'],
  },
  {
    uri: 'at://did:plc:kim/app.observ.occurrence/fern1', cid: 'bafyfern1', observer: kim,
    effectiveTaxonomy: { scientificName: 'Polypodium', rank: 'genus', kingdom: 'Plantae', family: 'Polypodiaceae', genus: 'Polypodium' },
    identificationCount: 0, eventDate: '2026-09-10T11:15:00Z',
    images: photo('fern'), externalRecords: [], createdAt: '2026-09-10T11:20:00Z', likeCount: 0,
    qualityIssues: ['NO_CONSENSUS_ID'],
  },
];
