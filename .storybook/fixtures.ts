/**
 * Plausible mock data for stories. Hand-rolled rather than generated so a
 * single fixture can be tweaked across many stories without re-running a
 * generator. Names follow real species so the rendering looks honest.
 */
import type {
  Comment,
  EffectiveTaxonomy,
  Identification,
  Notification,
  Occurrence,
  Profile,
  TaxonDetail,
  User,
} from "../frontend/src/services/types";

const PHOTO =
  "https://commons.wikimedia.org/wiki/Special:FilePath/Quercus_robur.jpg?width=600";
const AVATAR =
  "https://commons.wikimedia.org/wiki/Special:FilePath/Quercus_robur.jpg?width=80";

export const ALICE_USER: User = {
  did: "did:plc:alice",
  handle: "alice.bsky.social",
  displayName: "Alice Botanist",
  avatar: AVATAR,
};

export const ALICE_PROFILE: Profile = {
  did: "did:plc:alice",
  handle: "alice.bsky.social",
  displayName: "Alice Botanist",
  avatar: AVATAR,
};

export const BOB_PROFILE: Profile = {
  did: "did:plc:bob",
  handle: "bob.bsky.social",
  displayName: "Bob Naturalist",
};

export const OAK_TAXONOMY: EffectiveTaxonomy = {
  scientificName: "Quercus robur",
  vernacularName: "English Oak",
  rank: "species",
  kingdom: "Plantae",
  phylum: "Tracheophyta",
  class: "Magnoliopsida",
  order: "Fagales",
  family: "Fagaceae",
  genus: "Quercus",
};

export const OAK_OBSERVATION: Occurrence = {
  uri: "at://did:plc:alice/app.observ.occurrence/oak1",
  cid: "bafyreioak1",
  observer: ALICE_PROFILE,
  effectiveTaxonomy: OAK_TAXONOMY,
  identificationCount: 2,
  eventDate: "2026-04-12T10:30:00Z",
  location: { latitude: 51.5074, longitude: -0.1278, uncertaintyMeters: 25 },
  images: [PHOTO],
  createdAt: "2026-04-12T10:35:00Z",
  likeCount: 3,
  viewerHasLiked: false,
};

export const FERN_OBSERVATION: Occurrence = {
  uri: "at://did:plc:bob/app.observ.occurrence/fern1",
  cid: "bafyreifern1",
  observer: BOB_PROFILE,
  effectiveTaxonomy: {
    scientificName: "Polypodium vulgare",
    vernacularName: "Common Polypody",
    rank: "species",
    kingdom: "Plantae",
    family: "Polypodiaceae",
    genus: "Polypodium",
  },
  identificationCount: 1,
  eventDate: "2026-04-10T14:00:00Z",
  location: { latitude: 51.51, longitude: -0.13 },
  images: [PHOTO],
  createdAt: "2026-04-10T14:05:00Z",
  likeCount: 0,
};

export const OAK_TAXON_DETAIL: TaxonDetail = {
  id: "Plantae/Quercus robur",
  scientificName: "Quercus robur",
  commonName: "English Oak",
  photoUrl: PHOTO,
  rank: "species",
  kingdom: "Plantae",
  phylum: "Tracheophyta",
  class: "Magnoliopsida",
  order: "Fagales",
  family: "Fagaceae",
  genus: "Quercus",
  species: "Quercus robur",
  source: "gbif",
  conservationStatus: { category: "LC", source: "IUCN" },
  ancestors: [
    { id: "Plantae", name: "Plantae", rank: "kingdom" },
    { id: "Plantae/Tracheophyta", name: "Tracheophyta", rank: "phylum" },
    { id: "Plantae/Magnoliopsida", name: "Magnoliopsida", rank: "class" },
    { id: "Plantae/Fagales", name: "Fagales", rank: "order" },
    { id: "Plantae/Fagaceae", name: "Fagaceae", rank: "family" },
    { id: "Plantae/Quercus", name: "Quercus", rank: "genus" },
  ],
  children: [],
  numDescendants: 0,
  extinct: false,
  descriptions: [
    {
      description:
        "<p>Quercus robur is a deciduous tree native to most of Europe west of the Caucasus.</p>",
      type: "general",
      source: "Wikipedia",
    },
  ],
  references: [],
  media: [],
  gbifUrl: "https://www.gbif.org/species/2878688",
  wikidataUrl: "https://www.wikidata.org/wiki/Q165145",
  observationCount: 142,
};

export const OAK_IDENTIFICATION: Identification = {
  identifier: ALICE_PROFILE,
  uri: "at://did:plc:alice/app.observ.identification/id1",
  cid: "bafyreiid1",
  did: ALICE_PROFILE.did,
  subject_uri: OAK_OBSERVATION.uri,
  subject_cid: OAK_OBSERVATION.cid,
  scientific_name: "Quercus robur",
  taxon_rank: "species",
  date_identified: "2026-04-12T11:00:00Z",
  kingdom: "Plantae",
  family: "Fagaceae",
  genus: "Quercus",
};

export const SAMPLE_COMMENT: Comment = {
  commenter: BOB_PROFILE,
  uri: "at://did:plc:bob/app.observ.comment/c1",
  cid: "bafyreicom1",
  did: BOB_PROFILE.did,
  subject_uri: OAK_OBSERVATION.uri,
  subject_cid: OAK_OBSERVATION.cid,
  body: "Great find — leaves on this one look textbook.",
  created_at: "2026-04-12T12:00:00Z",
};

export const SAMPLE_NOTIFICATION_LIKE: Notification = {
  id: 1,
  actorDid: BOB_PROFILE.did,
  kind: "like",
  subjectUri: OAK_OBSERVATION.uri,
  read: false,
  createdAt: "2026-04-12T13:00:00Z",
  actor: BOB_PROFILE,
};
