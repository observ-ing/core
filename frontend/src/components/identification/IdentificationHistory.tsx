import { Box, Stack, Chip } from "@mui/material";
import HistoryIcon from "@mui/icons-material/History";
import { countChipSx } from "../common/chipSx";
import type { Identification } from "../../services/types";
import { TaxonLink } from "../common/TaxonLink";
import { Section, SectionHeader } from "../common/Section";
import { RecordListItem } from "../common/RecordListItem";
import { EmptyState } from "../common/EmptyState";

export interface IdentificationHistoryProps {
  identifications: Identification[];
  /** Fallback kingdom to use if identification doesn't have kingdom data */
  kingdom?: string | undefined;
  /** DID of the observation's creator, used to show "Observer's ID" badge */
  observerDid?: string | undefined;
  /** Optional content rendered at the bottom of the panel (e.g. login prompt, add ID form) */
  footer?: React.ReactNode | undefined;
  /** Current user's DID, used to show delete button on own identifications */
  currentUserDid?: string | undefined;
  /** Called when an identification is deleted */
  onDeleteIdentification?: ((uri: string) => Promise<void>) | undefined;
}

export function IdentificationHistory({
  identifications,
  kingdom,
  observerDid,
  footer,
  currentUserDid,
  onDeleteIdentification,
}: IdentificationHistoryProps) {
  // Sort oldest first
  const sortedIds = [...identifications].sort(
    (a, b) => new Date(a.date_identified).getTime() - new Date(b.date_identified).getTime(),
  );

  // Build set of superseded identification URIs (user has a newer ID)
  const supersededUris = new Set<string>();
  const latestByUser = new Map<string, Identification>();
  for (const id of sortedIds) {
    const existing = latestByUser.get(id.did);
    if (
      !existing ||
      new Date(id.date_identified).getTime() > new Date(existing.date_identified).getTime()
    ) {
      if (existing) supersededUris.add(existing.uri);
      latestByUser.set(id.did, id);
    } else {
      supersededUris.add(id.uri);
    }
  }

  // Find the observer's earliest (first) identification for the "Observer's ID" badge
  const observerFirstIdUri = observerDid
    ? sortedIds.find((id) => id.did === observerDid)?.uri
    : undefined;

  return (
    <Section>
      <SectionHeader
        icon={<HistoryIcon fontSize="small" sx={{ color: "primary.main" }} />}
        title="Identification History"
        sx={{ mb: 2 }}
        {...(sortedIds.length > 0
          ? {
              trailing: <Chip label={sortedIds.length} size="small" sx={countChipSx} />,
            }
          : {})}
      />
      {sortedIds.length === 0 ? (
        <EmptyState
          message="No identifications yet. Be the first to suggest an ID!"
          p={0}
          sx={{ textAlign: "left" }}
        />
      ) : (
        <Stack spacing={2}>
          {sortedIds.map((id) => {
            const isSuperseded = supersededUris.has(id.uri);
            return (
              <RecordListItem
                key={id.uri}
                actor={id.identifier ?? {}}
                linkDid={id.identifier?.did || id.did}
                date={new Date(id.date_identified)}
                atUri={id.uri}
                borderColor={isSuperseded ? "text.disabled" : "primary.main"}
                opacity={isSuperseded ? 0.5 : 1}
                {...(currentUserDid && id.did === currentUserDid && onDeleteIdentification
                  ? { onDelete: () => onDeleteIdentification(id.uri) }
                  : {})}
                badges={
                  <>
                    {id.uri === observerFirstIdUri && (
                      <Chip label="Observer's ID" size="small" color="info" variant="outlined" />
                    )}
                    {isSuperseded && <Chip label="Superseded" size="small" variant="outlined" />}
                  </>
                }
                belowName={
                  <Box sx={{ mt: 0.5, textDecoration: isSuperseded ? "line-through" : "none" }}>
                    <TaxonLink
                      name={id.scientific_name}
                      kingdom={id.kingdom || kingdom}
                      rank={id.taxon_rank}
                    />
                  </Box>
                }
              />
            );
          })}
        </Stack>
      )}
      {footer}
    </Section>
  );
}
