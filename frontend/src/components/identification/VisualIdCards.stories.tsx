import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import { VisualIdCards } from "./VisualIdCards";
import type { SpeciesSuggestion } from "../../services/api";

const noop = () => undefined;

const JUNCOS: SpeciesSuggestion[] = [
  {
    scientificName: "Junco hyemalis",
    commonName: "Dark-eyed Junco",
    confidence: 0.32,
    kingdom: "Animalia",
    phylum: "Chordata",
    class: "Aves",
    order: "Passeriformes",
    family: "Passerellidae",
    genus: "Junco",
    inRange: true,
  },
  {
    scientificName: "Junco phaeonotus",
    commonName: "Yellow-eyed Junco",
    confidence: 0.28,
    kingdom: "Animalia",
    phylum: "Chordata",
    class: "Aves",
    order: "Passeriformes",
    family: "Passerellidae",
    genus: "Junco",
  },
  {
    scientificName: "Junco vulcani",
    commonName: "Volcano Junco",
    confidence: 0.22,
    kingdom: "Animalia",
    phylum: "Chordata",
    class: "Aves",
    order: "Passeriformes",
    family: "Passerellidae",
    genus: "Junco",
  },
  {
    scientificName: "Junco insularis",
    commonName: "Guadalupe Junco",
    confidence: 0.15,
    kingdom: "Animalia",
    phylum: "Chordata",
    class: "Aves",
    order: "Passeriformes",
    family: "Passerellidae",
    genus: "Junco",
  },
];

const DOMINANT_JUNCOS: SpeciesSuggestion[] = JUNCOS.map((s, i) => ({
  ...s,
  confidence: [0.78, 0.1, 0.06, 0.04][i] ?? s.confidence,
}));

const SINGLE_SUGGESTION: SpeciesSuggestion[] = [
  {
    scientificName: "Junco hyemalis",
    commonName: "Dark-eyed Junco",
    confidence: 0.93,
    kingdom: "Animalia",
    phylum: "Chordata",
    class: "Aves",
    order: "Passeriformes",
    family: "Passerellidae",
    genus: "Junco",
    inRange: true,
  },
];

/**
 * Diverse birds in different orders — model can only narrow it to "some bird".
 * Common ancestor is class Aves.
 */
const AMBIGUOUS_BIRDS: SpeciesSuggestion[] = [
  {
    scientificName: "Turdus migratorius",
    commonName: "American Robin",
    confidence: 0.32,
    kingdom: "Animalia",
    phylum: "Chordata",
    class: "Aves",
    order: "Passeriformes",
    family: "Turdidae",
    genus: "Turdus",
  },
  {
    scientificName: "Buteo jamaicensis",
    commonName: "Red-tailed Hawk",
    confidence: 0.28,
    kingdom: "Animalia",
    phylum: "Chordata",
    class: "Aves",
    order: "Accipitriformes",
    family: "Accipitridae",
    genus: "Buteo",
  },
  {
    scientificName: "Bubo virginianus",
    commonName: "Great Horned Owl",
    confidence: 0.22,
    kingdom: "Animalia",
    phylum: "Chordata",
    class: "Aves",
    order: "Strigiformes",
    family: "Strigidae",
    genus: "Bubo",
  },
  {
    scientificName: "Anas platyrhynchos",
    commonName: "Mallard",
    confidence: 0.15,
    kingdom: "Animalia",
    phylum: "Chordata",
    class: "Aves",
    order: "Anseriformes",
    family: "Anatidae",
    genus: "Anas",
  },
];

/**
 * Suggestions across kingdoms — no useful shared ancestor.
 * Component should fall back to a flat species list.
 */
const NO_COMMON_ANCESTOR: SpeciesSuggestion[] = [
  {
    scientificName: "Quercus robur",
    commonName: "English Oak",
    confidence: 0.4,
    kingdom: "Plantae",
    phylum: "Tracheophyta",
    class: "Magnoliopsida",
    order: "Fagales",
    family: "Fagaceae",
    genus: "Quercus",
  },
  {
    scientificName: "Sciurus carolinensis",
    commonName: "Eastern Gray Squirrel",
    confidence: 0.35,
    kingdom: "Animalia",
    phylum: "Chordata",
    class: "Mammalia",
    order: "Rodentia",
    family: "Sciuridae",
    genus: "Sciurus",
  },
];

const meta = {
  title: "Identification/VisualIdCards",
  component: VisualIdCards,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box sx={{ width: 380 }}>
        <Story />
      </Box>
    ),
  ],
  args: {
    onSelectSpecies: noop,
    onSelectAncestor: noop,
  },
} satisfies Meta<typeof VisualIdCards>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Four Junco species with split confidence — top result fails both the floor
 * (50%) and the gap (2× runner-up) tests, so we offer "Junco sp." as the
 * confident answer at genus level.
 */
export const Ambiguous: Story = {
  args: {
    suggestions: JUNCOS,
  },
};

/**
 * One species clearly wins (78% top, 10% runner-up). The species takes the
 * primary slot; the genus is still available as a small affordance for
 * users who want to hedge.
 */
export const Dominant: Story = {
  args: {
    suggestions: DOMINANT_JUNCOS,
  },
};

/**
 * Single high-confidence result — no alternatives, no ancestor card.
 */
export const Single: Story = {
  args: {
    suggestions: SINGLE_SUGGESTION,
  },
};

/**
 * Diverse birds across different orders. Model is very lost — closest shared
 * ancestor is class Aves. The component still rolls up rather than dumping
 * a flat list of unrelated candidates.
 */
export const AmbiguousAtClass: Story = {
  args: {
    suggestions: AMBIGUOUS_BIRDS,
  },
};

/**
 * Suggestions from different kingdoms — no rollup possible. Component falls
 * back to a flat species list with a "Possible species:" header.
 */
export const NoCommonAncestor: Story = {
  args: {
    suggestions: NO_COMMON_ANCESTOR,
  },
};
