import type { Meta, StoryObj } from "@storybook/react-vite";
import { List } from "@mui/material";
import { ExternalRecordsItem } from "./ExternalRecordsItem";

const meta = {
  title: "Observation/ExternalRecordsItem",
  component: ExternalRecordsItem,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <List disablePadding sx={{ maxWidth: 420 }}>
        <Story />
      </List>
    ),
  ],
} satisfies Meta<typeof ExternalRecordsItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const KnownService: Story = {
  args: {
    records: [
      { uri: "https://www.inaturalist.org/observations/123456789", service: "inaturalist" },
    ],
  },
};

export const MultipleServices: Story = {
  args: {
    records: [
      { uri: "https://www.inaturalist.org/observations/123456789", service: "inaturalist" },
      { uri: "https://bugguide.net/node/view/2261861", service: "bugguide" },
    ],
  },
};

/** `service` is optional, and its known values are not exhaustive. */
export const UnknownService: Story = {
  args: {
    records: [
      { uri: "https://observation.org/observation/321654987" },
      { uri: "https://www.inaturalist.nz/observations/55", service: "inaturalist-nz" },
    ],
  },
};

/** An at-uri has no web permalink to link to, so the URI itself is shown. */
export const AtProtocolRecord: Story = {
  args: {
    records: [
      {
        uri: "at://did:plc:jt6xegjm6ba2lt34aztyi2mn/app.gainforest.dwc.occurrence/3mu252kzh4y2h",
        service: "gainforest",
      },
      { uri: "at://did:plc:jt6xegjm6ba2lt34aztyi2mn/app.gainforest.dwc.occurrence/3mu252kzh4y2j" },
    ],
  },
};

/** The common case: the row disappears entirely rather than rendering "—". */
export const Empty: Story = {
  args: { records: [] },
};
