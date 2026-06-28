import { useState } from "react";
import DOMPurify from "dompurify";
import { Box, Typography, Button } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import NotesOutlinedIcon from "@mui/icons-material/NotesOutlined";
import type { TaxonDescription } from "../../bindings/TaxonDescription";
import { CollapsibleSection } from "../common/CollapsibleSection";

interface TaxonDescriptionSectionProps {
  descriptions: TaxonDescription[];
  sx?: SxProps<Theme>;
}

/**
 * Expanded-by-default "Description" section. Shows up to two descriptions
 * (clamped to six lines until "Read more" is clicked), each with its source.
 * Description HTML is sanitized with DOMPurify before rendering.
 */
export function TaxonDescriptionSection({ descriptions, sx }: TaxonDescriptionSectionProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <CollapsibleSection
      title="Description"
      icon={<NotesOutlinedIcon fontSize="small" sx={{ color: "primary.main" }} />}
      defaultExpanded
      sx={sx}
    >
      {descriptions.slice(0, 2).map((d, idx) => (
        <Box key={idx} sx={{ mb: idx < descriptions.length - 1 ? 2 : 0 }}>
          <Typography
            variant="body2"
            component="div"
            sx={{
              ...(!expanded && {
                display: "-webkit-box",
                WebkitLineClamp: 6,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }),
              "& p": { m: 0 },
              "& em, & i": { fontStyle: "italic" },
            }}
            // eslint-disable-next-line react/no-danger -- sanitized with DOMPurify
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(d.description, {
                ALLOWED_TAGS: ["p", "br", "em", "i", "strong", "b", "a"],
                ALLOWED_ATTR: ["href", "target", "rel"],
              }),
            }}
          />
          {d.source && (
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                mt: 0.5,
                display: "block",
              }}
            >
              Source: {d.source}
            </Typography>
          )}
        </Box>
      ))}
      <Button
        size="small"
        onClick={() => setExpanded((v) => !v)}
        sx={{ mt: 1, textTransform: "none" }}
      >
        {expanded ? "Show less" : "Read more"}
      </Button>
    </CollapsibleSection>
  );
}
