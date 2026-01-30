/**
 * Data enrichment functions for API responses
 *
 * These functions transform database rows into API response objects,
 * enriching them with profile information and community IDs.
 */

import {
  Database,
  getIdentityResolver,
  TaxonomyClient,
  type OccurrenceRow,
  type IdentificationRow,
  type CommentRow,
  type Profile,
} from "observing-shared";

// Singleton taxonomy client for taxonomy service calls
let taxonomyClient: TaxonomyClient | null = null;
function getTaxonomyClient(): TaxonomyClient {
  if (!taxonomyClient) {
    taxonomyClient = new TaxonomyClient();
  }
  return taxonomyClient;
}

interface ObserverInfo {
  did: string;
  handle?: string | undefined;
  displayName?: string | undefined;
  avatar?: string | undefined;
  role: "owner" | "co-observer";
}

interface SubjectResponse {
  index: number;
  communityId?: string | undefined;
  identificationCount: number;
}

interface EffectiveTaxonomy {
  scientificName: string;
  taxonId?: string | undefined;
  taxonRank?: string | undefined;
  vernacularName?: string | undefined;
  kingdom?: string | undefined;
  phylum?: string | undefined;
  class?: string | undefined;
  order?: string | undefined;
  family?: string | undefined;
  genus?: string | undefined;
}

export interface OccurrenceResponse {
  uri: string;
  cid: string;
  observer: {
    did: string;
    handle?: string | undefined;
    displayName?: string | undefined;
    avatar?: string | undefined;
  };
  observers: ObserverInfo[];
  scientificName?: string | undefined;
  communityId?: string | undefined;
  effectiveTaxonomy?: EffectiveTaxonomy | undefined;
  subjects: SubjectResponse[];
  eventDate: string;
  location: {
    latitude: number;
    longitude: number;
    uncertaintyMeters?: number | undefined;
    continent?: string | undefined;
    country?: string | undefined;
    countryCode?: string | undefined;
    stateProvince?: string | undefined;
    county?: string | undefined;
    municipality?: string | undefined;
    locality?: string | undefined;
    waterBody?: string | undefined;
  };
  verbatimLocality?: string | undefined;
  occurrenceRemarks?: string | undefined;
  taxonId?: string | undefined;
  taxonRank?: string | undefined;
  vernacularName?: string | undefined;
  kingdom?: string | undefined;
  phylum?: string | undefined;
  class?: string | undefined;
  order?: string | undefined;
  family?: string | undefined;
  genus?: string | undefined;
  images: string[];
  createdAt: string;
}

export async function enrichOccurrences(
  db: Database,
  rows: OccurrenceRow[]
): Promise<OccurrenceResponse[]> {
  if (rows.length === 0) return [];

  // Get unique DIDs from occurrences
  const dids = [...new Set(rows.map((r) => r.did))];
  const resolver = getIdentityResolver();
  const profiles = await resolver.getProfiles(dids);

  return Promise.all(
    rows.map(async (row) => {
      const profile = profiles.get(row.did);

      // Get observers from database
      const observerData = await db.getOccurrenceObservers(row.uri);
      const observerDids = observerData.map((o) => o.did);

      // Get profiles for all observers (if not already fetched)
      const allDids = [...new Set([...dids, ...observerDids])];
      const allProfiles =
        allDids.length > dids.length
          ? await resolver.getProfiles(allDids)
          : profiles;

      const observers: ObserverInfo[] = observerData.map((o) => {
        const observerProfile = allProfiles.get(o.did);
        return {
          did: o.did,
          handle: observerProfile?.handle,
          displayName: observerProfile?.displayName,
          avatar: observerProfile?.avatar,
          role: o.role,
        };
      });

      // If no observers in table yet, add owner from occurrence
      if (observers.length === 0) {
        observers.push({
          did: row.did,
          handle: profile?.handle,
          displayName: profile?.displayName,
          avatar: profile?.avatar,
          role: "owner" as const,
        });
      }

      // Get all subjects for this occurrence
      const subjectData = await db.getSubjectsForOccurrence(row.uri);

      // Build subjects array with community IDs
      const subjects: SubjectResponse[] = [];

      // Always include subject 0
      if (!subjectData.some((s) => s.subjectIndex === 0)) {
        subjectData.unshift({
          subjectIndex: 0,
          identificationCount: 0,
          latestIdentification: null,
        });
      }

      for (const subject of subjectData) {
        const subjectCommunityId = await db.getCommunityId(
          row.uri,
          subject.subjectIndex
        );
        subjects.push({
          index: subject.subjectIndex,
          communityId: subjectCommunityId || undefined,
          identificationCount: subject.identificationCount,
        });
      }

      // Get community ID for subject 0 (backward compat)
      const communityId = await db.getCommunityId(row.uri, 0);

      // Get effective taxonomy from the winning identification for subject 0
      let effectiveTaxonomy: EffectiveTaxonomy | undefined;
      const effectiveName = communityId || row.scientific_name;
      if (effectiveName) {
        const identifications = communityId
          ? await db.getIdentificationsForOccurrence(row.uri)
          : [];
        // Find an identification that matches the community ID
        const winningId = identifications.find(
          (id) =>
            id.subject_index === 0 &&
            id.scientific_name?.toLowerCase() === communityId?.toLowerCase()
        );
        if (winningId?.kingdom) {
          // Use winning identification taxonomy if it has kingdom data
          effectiveTaxonomy = {
            scientificName: winningId.scientific_name,
            taxonId: undefined, // Deprecated: use kingdom + scientificName for taxon resolution
            taxonRank: winningId.taxon_rank || undefined,
            vernacularName: winningId.vernacular_name || undefined,
            kingdom: winningId.kingdom,
            phylum: winningId.phylum || undefined,
            class: winningId.class || undefined,
            order: winningId.order || undefined,
            family: winningId.family || undefined,
            genus: winningId.genus || undefined,
          };
        } else {
          // Look up taxonomy from GBIF when winning identification lacks kingdom
          try {
            const taxonomy = getTaxonomyClient();
            const taxonDetail = await taxonomy.getByName(effectiveName);
            if (taxonDetail) {
              effectiveTaxonomy = {
                scientificName: taxonDetail.scientificName,
                taxonId: undefined,
                taxonRank: taxonDetail.rank || undefined,
                vernacularName: taxonDetail.commonName || undefined,
                kingdom: taxonDetail.kingdom || undefined,
                phylum: taxonDetail.phylum || undefined,
                class: taxonDetail.class || undefined,
                order: taxonDetail.order || undefined,
                family: taxonDetail.family || undefined,
                genus: taxonDetail.genus || undefined,
              };
            }
          } catch {
            // GBIF lookup failed, leave effectiveTaxonomy undefined
          }
        }
      }

      return {
        uri: row.uri,
        cid: row.cid,
        observer: {
          did: row.did,
          handle: profile?.handle,
          displayName: profile?.displayName,
          avatar: profile?.avatar,
        },
        observers,
        scientificName: row.scientific_name || undefined,
        communityId: communityId || undefined,
        effectiveTaxonomy,
        subjects,
        eventDate: row.event_date.toISOString(),
        location: {
          latitude: row.latitude,
          longitude: row.longitude,
          uncertaintyMeters: row.coordinate_uncertainty_meters || undefined,
          continent: row.continent || undefined,
          country: row.country || undefined,
          countryCode: row.country_code || undefined,
          stateProvince: row.state_province || undefined,
          county: row.county || undefined,
          municipality: row.municipality || undefined,
          locality: row.locality || undefined,
          waterBody: row.water_body || undefined,
        },
        verbatimLocality: row.verbatim_locality || undefined,
        occurrenceRemarks: row.occurrence_remarks || undefined,
        taxonId: row.taxon_id || undefined,
        taxonRank: row.taxon_rank || undefined,
        vernacularName: row.vernacular_name || undefined,
        kingdom: row.kingdom || undefined,
        phylum: row.phylum || undefined,
        class: row.class || undefined,
        order: row.order || undefined,
        family: row.family || undefined,
        genus: row.genus || undefined,
        images: (
          (row.associated_media || []) as Array<{
            image: { ref: string | { $link: string } };
          }>
        ).map((b) => {
          const ref = b.image?.ref;
          const cid =
            typeof ref === "string" ? ref : (ref as { $link: string })?.$link;
          return `/media/blob/${row.did}/${cid || ""}`;
        }),
        createdAt: row.created_at.toISOString(),
      };
    })
  );
}

export async function enrichIdentifications(
  rows: IdentificationRow[]
): Promise<Array<IdentificationRow & { identifier?: Partial<Profile> }>> {
  if (rows.length === 0) return [];

  const dids = [...new Set(rows.map((r) => r.did))];
  const resolver = getIdentityResolver();
  const profiles = await resolver.getProfiles(dids);

  return rows.map((row) => {
    const profile = profiles.get(row.did);
    return {
      ...row,
      ...(profile && {
        identifier: {
          did: profile.did,
          handle: profile.handle,
          displayName: profile.displayName,
          avatar: profile.avatar,
        },
      }),
    };
  });
}

export async function enrichComments(
  rows: CommentRow[]
): Promise<Array<CommentRow & { commenter?: Partial<Profile> }>> {
  if (rows.length === 0) return [];

  const dids = [...new Set(rows.map((r) => r.did))];
  const resolver = getIdentityResolver();
  const profiles = await resolver.getProfiles(dids);

  return rows.map((row) => {
    const profile = profiles.get(row.did);
    return {
      ...row,
      ...(profile && {
        commenter: {
          did: profile.did,
          handle: profile.handle,
          displayName: profile.displayName,
          avatar: profile.avatar,
        },
      }),
    };
  });
}
