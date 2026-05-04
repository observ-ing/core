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
  disabled?: boolean;
  onExpandedItemsChange: (ids: string[]) => void;
  onSelectedItemsChange: (id: string) => void;
  onItemExpansionToggle: (id: string, isExpanded: boolean) => void;
}

function renderTreeItems(items: TaxonTreeItem[], selectedId: string, loadingNodeId: string | null) {
  return items.map((item) => (
    <TreeItem
      key={item.id}
      itemId={item.id}
      label={
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, py: 0.25 }}>
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
      {item.children && renderTreeItems(item.children, selectedId, loadingNodeId)}
    </TreeItem>
  ));
}

export function TaxonTreePanel({
  items,
  expandedItems,
  selectedItems,
  loadingNodeId,
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
        {renderTreeItems(items, selectedItems, loadingNodeId)}
      </SimpleTreeView>
    </Box>
  );
}
