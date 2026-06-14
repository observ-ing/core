import { Box, CircularProgress, Typography } from "@mui/material";
import { SimpleTreeView } from "@mui/x-tree-view/SimpleTreeView";
import { TreeItem } from "@mui/x-tree-view/TreeItem";
import type { TaxonTreeItem } from "./TaxonExplorer";
import { TaxonSearchBox } from "./TaxonSearchBox";
import { shouldItalicizeTaxonName } from "../common/TaxonLink";

interface TaxonTreePanelProps {
  items: TaxonTreeItem[];
  expandedItems: string[];
  selectedItems: string;
  loadingNodeId: string | null;
  thumbnails: Map<string, string>;
  disabled?: boolean;
  onExpandedItemsChange: (ids: string[]) => void;
  onSelectedItemsChange: (id: string) => void;
  onItemExpansionToggle: (id: string, isExpanded: boolean) => void;
  /** Called after the search box navigates (e.g. to close the mobile drawer). */
  onSearchNavigate?: (() => void) | undefined;
}

function renderTreeItems(
  items: TaxonTreeItem[],
  selectedId: string,
  loadingNodeId: string | null,
  thumbnails: Map<string, string>,
) {
  return items.map((item) => {
    const thumb = thumbnails.get(String(item.label));
    return (
      <TreeItem
        key={item.id}
        itemId={item.id}
        // The expand/collapse arrow lives inside the selectable content, so a
        // click on it bubbles up and selects (navigates to) the item. Stop the
        // arrow click from reaching the content handler; MUI runs this before
        // its own expansion logic, so collapsing/expanding still works.
        slotProps={{ iconContainer: { onClick: (event) => event.stopPropagation() } }}
        label={
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, py: 0.5 }}>
            {/* Only reserve the thumbnail slot when there's actually an image —
                most taxa have none, and a column of empty placeholders is just
                noise that steals width the name needs at depth. */}
            {thumb && (
              <Box
                sx={{
                  width: 20,
                  height: 20,
                  flexShrink: 0,
                  borderRadius: 0.5,
                  overflow: "hidden",
                }}
              >
                <Box
                  component="img"
                  src={thumb}
                  alt=""
                  loading="lazy"
                  sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </Box>
            )}
            <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1 }}>
              <Typography
                variant="body2"
                component="span"
                noWrap
                title={String(item.label)}
                sx={{
                  fontStyle: shouldItalicizeTaxonName(String(item.label), item.rank)
                    ? "italic"
                    : "normal",
                  fontWeight: item.id === selectedId ? 700 : 400,
                }}
              >
                {item.label}
              </Typography>
              {item.commonName && (
                <Typography
                  variant="caption"
                  component="span"
                  noWrap
                  title={item.commonName}
                  sx={{
                    color: "text.secondary",
                    lineHeight: 1.2,
                  }}
                >
                  {item.commonName}
                </Typography>
              )}
            </Box>
            {/* Rank yields to the name: with a large flex-shrink it collapses
                before the (more important) name truncates, so short names show
                the rank and long names reclaim the full row. */}
            <Typography
              variant="caption"
              component="span"
              sx={{
                ml: 0.75,
                flexShrink: 100,
                minWidth: 0,
                overflow: "hidden",
                whiteSpace: "nowrap",
                color: "text.disabled",
                fontSize: "0.65rem",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {item.rank}
            </Typography>
            {loadingNodeId === item.id && <CircularProgress size={14} />}
          </Box>
        }
      >
        {item.children && renderTreeItems(item.children, selectedId, loadingNodeId, thumbnails)}
      </TreeItem>
    );
  });
}

export function TaxonTreePanel({
  items,
  expandedItems,
  selectedItems,
  loadingNodeId,
  thumbnails,
  disabled,
  onExpandedItemsChange,
  onSelectedItemsChange,
  onItemExpansionToggle,
  onSearchNavigate,
}: TaxonTreePanelProps) {
  return (
    <Box
      sx={{
        p: 1,
        height: "100%",
        overflow: "auto",
        transition: "opacity 0.15s",
      }}
    >
      <Box sx={{ px: 1, pt: 1, pb: 0.5 }}>
        <TaxonSearchBox onNavigate={onSearchNavigate} />
      </Box>
      <Box
        sx={{
          pointerEvents: disabled ? "none" : "auto",
          opacity: disabled ? 0.5 : 1,
          transition: "opacity 0.15s",
        }}
      >
        <Typography
          variant="subtitle2"
          sx={{
            color: "text.secondary",
            px: 1,
            py: 1,
          }}
        >
          Classification
        </Typography>
        <SimpleTreeView
          expansionTrigger="iconContainer"
          expandedItems={expandedItems}
          selectedItems={selectedItems}
          onExpandedItemsChange={(_e, ids) => onExpandedItemsChange(ids)}
          onSelectedItemsChange={(_e, id) => {
            if (id) onSelectedItemsChange(id);
          }}
          onItemExpansionToggle={(_e, id, isExpanded) => onItemExpansionToggle(id, isExpanded)}
        >
          {renderTreeItems(items, selectedItems, loadingNodeId, thumbnails)}
        </SimpleTreeView>
      </Box>
    </Box>
  );
}
