import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chip, Typography } from "@mui/material";
import HistoryIcon from "@mui/icons-material/History";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { Section, SectionHeader } from "./Section";

const meta = {
  title: "Common/Section",
  component: Section,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Bordered card wrapper used by the observation detail sections so they read as peers. Pair it with `SectionHeader` for the icon + title (+ trailing slot) row.",
      },
    },
  },
  tags: ["autodocs"],
  // Each story supplies its own composition via `render`; this satisfies the
  // required `children` prop on the meta.
  args: {
    children: null,
  },
} satisfies Meta<typeof Section>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Section>
      <SectionHeader
        icon={<InfoOutlinedIcon fontSize="small" sx={{ color: "primary.main" }} />}
        title="Details"
        sx={{ mb: 1.5 }}
      />
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        Section body content goes here.
      </Typography>
    </Section>
  ),
};

export const WithTrailingCount: Story = {
  render: () => (
    <Section>
      <SectionHeader
        icon={<HistoryIcon fontSize="small" sx={{ color: "primary.main" }} />}
        title="Identification History"
        sx={{ mb: 1.5 }}
        trailing={<Chip label={3} size="small" sx={{ height: 20, fontSize: "0.75rem" }} />}
      />
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        The trailing slot is right-aligned — use it for a count chip, an action button, or a
        collapse toggle.
      </Typography>
    </Section>
  ),
};

export const Clickable: Story = {
  render: () => (
    <Section>
      <SectionHeader
        icon={<InfoOutlinedIcon fontSize="small" sx={{ color: "primary.main" }} />}
        title="Data quality"
        onClick={() => {}}
        trailing={
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            All criteria met
          </Typography>
        }
      />
    </Section>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Passing `onClick` makes the whole header row a pointer target (used by collapsibles).",
      },
    },
  },
};
