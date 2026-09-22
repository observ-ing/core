import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mui/material";
import type { ExternalRecord } from "../../bindings/ExternalRecord";
import { ExternalRecordsField } from "./ExternalRecordsField";
import { MAX_EXTERNAL_RECORDS } from "../../lib/externalRecords";

/**
 * Stateful wrapper so the stories behave like the real form: adding and
 * removing links updates the chips.
 */
function ExternalRecordsFieldHarness({ records: initial }: { records: ExternalRecord[] }) {
  const [records, setRecords] = useState(initial);
  return (
    <Box sx={{ maxWidth: 520 }}>
      <ExternalRecordsField records={records} onChange={setRecords} />
    </Box>
  );
}

const meta = {
  title: "Modals/ExternalRecordsField",
  component: ExternalRecordsFieldHarness,
  tags: ["autodocs"],
} satisfies Meta<typeof ExternalRecordsFieldHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { records: [] },
};

export const WithRecords: Story = {
  args: {
    records: [
      { uri: "https://www.inaturalist.org/observations/123456789", service: "inaturalist" },
      { uri: "https://bugguide.net/node/view/2261861", service: "bugguide" },
      { uri: "at://did:plc:gainforest/app.gainforest.dwc.occurrence/3mu252kzh4y2h" },
    ],
  },
};

/** At the lexicon's cap the input is disabled rather than failing on save. */
export const AtCapacity: Story = {
  args: {
    records: Array.from({ length: MAX_EXTERNAL_RECORDS }, (_, i) => ({
      uri: `https://www.inaturalist.org/observations/${i + 1}`,
      service: "inaturalist",
    })),
  },
};
