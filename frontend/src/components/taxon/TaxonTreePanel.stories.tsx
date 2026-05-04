import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { TaxonTreePanel } from "./TaxonTreePanel";
import type { TaxonTreeItem } from "./TaxonExplorer";

const SAMPLE_ITEMS: TaxonTreeItem[] = [
  {
    id: "Plantae",
    label: "Plantae",
    rank: "kingdom",
    children: [
      {
        id: "Plantae/Tracheophyta",
        label: "Tracheophyta",
        rank: "phylum",
        children: [
          {
            id: "Plantae/Magnoliopsida",
            label: "Magnoliopsida",
            rank: "class",
            children: [
              {
                id: "Plantae/Fagales",
                label: "Fagales",
                rank: "order",
                children: [
                  {
                    id: "Plantae/Fagaceae",
                    label: "Fagaceae",
                    rank: "family",
                    children: [
                      {
                        id: "Plantae/Quercus",
                        label: "Quercus",
                        rank: "genus",
                        children: [
                          {
                            id: "Plantae/Quercus robur",
                            label: "Quercus robur",
                            rank: "species",
                          },
                          {
                            id: "Plantae/Quercus alba",
                            label: "Quercus alba",
                            rank: "species",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

const ALL_EXPANDED = [
  "Plantae",
  "Plantae/Tracheophyta",
  "Plantae/Magnoliopsida",
  "Plantae/Fagales",
  "Plantae/Fagaceae",
  "Plantae/Quercus",
];

const meta = {
  title: "Taxon/TaxonTreePanel",
  component: TaxonTreePanel,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    thumbnails: new Map<string, string>(),
    onExpandedItemsChange: () => undefined,
    onSelectedItemsChange: () => undefined,
    onItemExpansionToggle: () => undefined,
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 300, height: 500, border: "1px solid", borderColor: "divider" }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof TaxonTreePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {
  args: {
    items: SAMPLE_ITEMS,
    expandedItems: ALL_EXPANDED,
    selectedItems: "Plantae/Quercus robur",
    loadingNodeId: null,
  },
};

export const Collapsed: Story = {
  args: {
    items: SAMPLE_ITEMS,
    expandedItems: [],
    selectedItems: "",
    loadingNodeId: null,
  },
};

export const LoadingChildren: Story = {
  args: {
    items: SAMPLE_ITEMS,
    expandedItems: ALL_EXPANDED,
    selectedItems: "Plantae/Quercus",
    loadingNodeId: "Plantae/Quercus",
  },
};

export const Disabled: Story = {
  args: {
    items: SAMPLE_ITEMS,
    expandedItems: ALL_EXPANDED,
    selectedItems: "Plantae/Quercus robur",
    loadingNodeId: null,
    disabled: true,
  },
};

export const Empty: Story = {
  args: {
    items: [],
    expandedItems: [],
    selectedItems: "",
    loadingNodeId: null,
  },
};
