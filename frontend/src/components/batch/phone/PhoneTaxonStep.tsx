// Phone layout, identification: a search box with its results below it, full
// screen. Visual ID suggestions come only when asked for and never alongside a
// typed query, so the list is always one thing or the other.
import { useState } from "react";
import {
  Box,
  Button,
  ButtonBase,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import CheckIcon from "@mui/icons-material/Check";
import ClearIcon from "@mui/icons-material/Clear";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditNoteIcon from "@mui/icons-material/EditNote";
import { KingdomSelect } from "../../common/KingdomSelect";
import { RankSelect } from "../../common/RankSelect";
import { SearchAdornment, searchFieldSx } from "../../common/SearchField";
import { shouldItalicizeTaxonName } from "../../common/TaxonLink";
import { TaxonThumbnail } from "../../common/TaxonThumbnail";
import {
  coverImageSx,
  thumbnailFrameSx,
  touchTarget,
  touchTargetLarge,
} from "../../common/layoutSx";
import { VisualId } from "../../identification/VisualId";
import { useDebouncedTaxaSearch } from "../../../hooks/useDebouncedTaxaSearch";
import { EMPTY_TAXON, type BatchObservation, type BatchTaxon } from "../../../lib/batchUpload";
import { shared, taxonFromAncestor, taxonFromSuggestion } from "../BatchEditor";
import { PhoneStep } from "./PhoneStep";

export interface PhoneTaxonStepProps {
  /** The observations being identified: one, or several to give the same name. */
  observations: BatchObservation[];
  /** Sets the identification; the step is done once it has been called. */
  onChoose: (taxon: Partial<BatchTaxon>) => void;
  onBack: () => void;
}

export function PhoneTaxonStep({ observations, onChoose, onBack }: PhoneTaxonStepProps) {
  const [query, setQuery] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  // A name that isn't in the taxonomy, waiting for its kingdom.
  const [unmatched, setUnmatched] = useState<string | null>(null);
  const [kingdom, setKingdom] = useState("");
  const [rank, setRank] = useState("");
  const { suggestions, search, clearSuggestions } = useDebouncedTaxaSearch();

  const [first] = observations;
  if (!first) return null;
  const single = observations.length === 1;
  const [cover] = first.photos;
  const current = shared(observations.map((o) => o.taxon.name.trim()));
  const typed = query.trim();

  const changeQuery = (value: string) => {
    setQuery(value);
    // Clearing the box brings back the button, not the earlier suggestions.
    setSuggesting(false);
    if (value.trim()) search(value);
    else clearSuggestions();
  };

  if (unmatched !== null) {
    return (
      <PhoneStep
        title="Name not in the taxonomy"
        subtitle={unmatched}
        backLabel="Back to search"
        onBack={() => setUnmatched(null)}
        footer={
          <Button
            variant="contained"
            startIcon={<CheckIcon />}
            disabled={!kingdom}
            onClick={() => onChoose({ name: unmatched, match: null, kingdom, rank })}
            sx={{ minHeight: touchTargetLarge }}
          >
            Use this name
          </Button>
        }
      >
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Choose the kingdom "{unmatched}" belongs to. The rank is optional.
        </Typography>
        <Box>
          <KingdomSelect idPrefix="phone-kingdom" value={kingdom} onChange={setKingdom} />
          <RankSelect idPrefix="phone-rank" value={rank} onChange={setRank} />
        </Box>
      </PhoneStep>
    );
  }

  return (
    <PhoneStep title="Identification" backLabel="Back without changing" onBack={onBack}>
      <TextField
        autoFocus
        fullWidth
        value={query}
        onChange={(event) => changeQuery(event.target.value)}
        placeholder="Search species or other taxa"
        slotProps={{
          htmlInput: { "aria-label": "Search species or other taxa", enterKeyHint: "search" },
          input: {
            startAdornment: <SearchAdornment />,
            endAdornment: query && (
              <InputAdornment position="end">
                <IconButton edge="end" aria-label="Clear search" onClick={() => changeQuery("")}>
                  <ClearIcon />
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
        sx={searchFieldSx}
      />

      {typed ? (
        <>
          {suggestions.length > 0 && (
            <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: "hidden" }}>
              <List disablePadding aria-label="Search results">
                {suggestions.map((taxon) => (
                  <ListItemButton
                    key={taxon.id}
                    divider
                    onClick={() =>
                      onChoose({
                        name: taxon.scientificName,
                        match: taxon,
                        kingdom: taxon.kingdom ?? "",
                        rank: "",
                      })
                    }
                    sx={{ gap: 1.5, minHeight: 64 }}
                  >
                    <TaxonThumbnail src={taxon.photoUrl} size={44} emptyBgcolor="action.hover" />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        noWrap
                        sx={{
                          fontWeight: 600,
                          fontStyle: shouldItalicizeTaxonName(taxon.scientificName, taxon.rank)
                            ? "italic"
                            : "normal",
                        }}
                      >
                        {taxon.scientificName}
                      </Typography>
                      {/* As in TaxaAutocompleteView: a synonym names what it stands for. */}
                      {taxon.isSynonym ? (
                        <Typography variant="body2" noWrap sx={{ color: "text.secondary" }}>
                          Synonym{taxon.acceptedName ? ` of ${taxon.acceptedName}` : ""}
                        </Typography>
                      ) : (
                        taxon.commonName && (
                          <Typography variant="body2" noWrap sx={{ color: "text.secondary" }}>
                            {taxon.commonName}
                          </Typography>
                        )
                      )}
                    </Box>
                    <Typography
                      variant="caption"
                      sx={{ color: "text.secondary", textTransform: "capitalize" }}
                    >
                      {taxon.rank.toLowerCase()}
                    </Typography>
                  </ListItemButton>
                ))}
              </List>
            </Paper>
          )}
          <ButtonBase
            onClick={() => {
              setKingdom("");
              setRank("");
              setUnmatched(typed);
            }}
            sx={{
              gap: 1.5,
              p: 1.75,
              border: 1,
              borderStyle: "dashed",
              borderColor: "text.secondary",
              borderRadius: 1.5,
              textAlign: "left",
              justifyContent: "flex-start",
            }}
          >
            <EditNoteIcon sx={{ color: "text.secondary" }} />
            <Typography variant="body2">
              Use "{typed}" as a name that is not in the taxonomy. You will choose a kingdom next.
            </Typography>
          </ButtonBase>
        </>
      ) : suggesting && cover ? (
        <>
          <Typography component="h2" sx={{ fontWeight: 700 }}>
            Suggested from the first photo
          </Typography>
          <VisualId
            imageUrl={cover.previewUrl}
            latitude={first.latitude ?? undefined}
            longitude={first.longitude ?? undefined}
            autoFetch
            onSelect={(s) => onChoose(taxonFromSuggestion(s))}
            onSelectAncestor={(ancestor) => onChoose(taxonFromAncestor(ancestor))}
          />
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Suggestions are automated and can be wrong. Typing in the search box replaces them with
            search results.
          </Typography>
        </>
      ) : (
        <>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {single
              ? "Type a name to search, or ask for suggestions."
              : `Type a name to search. Choosing one sets it on all ${observations.length}.`}
          </Typography>
          {/* Suggestions are for one photo, so not for several observations at once. */}
          {single && cover && (
            <ButtonBase
              onClick={() => setSuggesting(true)}
              sx={{
                gap: 1.5,
                p: 1.5,
                border: 1,
                borderColor: "primary.main",
                borderRadius: 1.5,
                bgcolor: "background.paper",
                textAlign: "left",
                justifyContent: "flex-start",
              }}
            >
              <Box sx={{ width: 56, height: 56, flexShrink: 0, ...thumbnailFrameSx }}>
                <Box component="img" src={cover.previewUrl} alt="" sx={coverImageSx} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  sx={{ display: "flex", alignItems: "center", gap: 0.75, fontWeight: 600 }}
                >
                  <AutoFixHighIcon fontSize="small" color="primary" />
                  Suggest from the first photo
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Uses the photo and the location, if set.
                </Typography>
              </Box>
            </ButtonBase>
          )}
          {current !== "" && (
            <Button
              color="error"
              startIcon={<DeleteOutlineIcon />}
              onClick={() => onChoose(EMPTY_TAXON)}
              sx={{ alignSelf: "flex-start", minHeight: touchTarget }}
            >
              Remove identification
            </Button>
          )}
        </>
      )}
    </PhoneStep>
  );
}
