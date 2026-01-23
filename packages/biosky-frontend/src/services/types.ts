export interface Subject {
  index: number;
  communityId?: string;
  identificationCount: number;
}

export interface Occurrence {
  uri: string;
  cid: string;
  observer: {
    did: string;
    handle?: string;
    displayName?: string;
    avatar?: string;
  };
  scientificName?: string;
  communityId?: string; // Backward compat: refers to subject 0
  subjects: Subject[]; // All subjects with their community IDs
  eventDate: string;
  location: {
    latitude: number;
    longitude: number;
    uncertaintyMeters?: number;
  };
  verbatimLocality?: string;
  occurrenceRemarks?: string;
  images: string[];
  createdAt: string;
}

export interface User {
  did: string;
  handle: string;
}

export type ViewMode = "feed" | "map";
export type FeedTab = "home" | "explore";

/**
 * IUCN Red List conservation status categories
 */
export type IUCNCategory =
  | "EX" // Extinct
  | "EW" // Extinct in the Wild
  | "CR" // Critically Endangered
  | "EN" // Endangered
  | "VU" // Vulnerable
  | "NT" // Near Threatened
  | "LC" // Least Concern
  | "DD" // Data Deficient
  | "NE"; // Not Evaluated

export interface ConservationStatus {
  category: IUCNCategory;
  source: string;
}

export interface TaxaResult {
  scientificName: string;
  commonName?: string;
  photoUrl?: string;
  rank?: string;
  conservationStatus?: ConservationStatus;
}

export interface FeedResponse {
  occurrences: Occurrence[];
  cursor?: string;
}

export interface FeedFilters {
  taxon?: string;
  lat?: number;
  lng?: number;
  radius?: number;
}

export interface ExploreFeedResponse extends FeedResponse {
  meta?: {
    filters?: FeedFilters;
  };
}

export interface HomeFeedResponse extends FeedResponse {
  meta?: {
    followedCount: number;
    nearbyCount: number;
    totalFollows: number;
  };
}

export interface Identification {
  uri: string;
  cid: string;
  did: string;
  subject_uri: string;
  subject_index: number;
  scientific_name: string;
  taxon_rank?: string;
  identification_remarks?: string;
  is_agreement: boolean;
  date_identified: string;
  identifier?: {
    did: string;
    handle?: string;
    displayName?: string;
    avatar?: string;
  };
}

export interface ProfileData {
  did: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
}

export interface ProfileFeedResponse {
  profile: ProfileData;
  counts: {
    observations: number;
    identifications: number;
    species: number;
  };
  occurrences: Occurrence[];
  identifications: Identification[];
  cursor?: string;
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "Point";
      coordinates: [number, number];
    };
    properties: {
      uri: string;
      scientificName?: string;
      point_count?: number;
      cluster_id?: number;
    };
  }>;
}
