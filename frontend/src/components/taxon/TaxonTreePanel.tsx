import { Box, CircularProgress, Typography } from "@mui/material";
import { SimpleTreeView } from "@mui/x-tree-view/SimpleTreeView";
import { TreeItem } from "@mui/x-tree-view/TreeItem";
import type { TaxonTreeItem } from "./TaxonExplorer";
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
        label={
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, py: 0.25 }}>
            <Box
              sx={{
                width: 20,
                height: 20,
                flexShrink: 0,
                borderRadius: 0.5,
                overflow: "hidden",
                bgcolor: "action.hover",
              }}
            >
              {thumb && (
                <Box
                  component="img"
                  src={thumb}
                  alt=""
                  loading="lazy"
                  sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              )}
            </Box>
            <Typography
              variant="body2"
              component="span"
              sx={{
                fontStyle: shouldItalicizeTaxonName(String(item.label), item.rank)
                  ? "italic"
                  : "normal",
                fontWeight: item.id === selectedId ? 700 : 400,
              }}
            >
              {item.label}
            </Typography>
            <Typography
              variant="caption"
              component="span"
              sx={{
                color: "text.disabled",
                flexShrink: 0,
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
}: TaxonTreePanelProps) {
  return (
    <Box
      sx={{
        p: 1,
        height: "100%",
        overflow: "auto",
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
  );
}
