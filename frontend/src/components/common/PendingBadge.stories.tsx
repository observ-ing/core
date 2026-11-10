import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Typography,
} from "@mui/material";
import { PendingBadge, pendingCardSx } from "./PendingBadge";

const meta = {
  title: "Common/PendingBadge",
  component: PendingBadge,
  parameters: {
    layout: "padded",
  },
  // The badge is absolutely positioned, so anchor it to a relative box sized
  // like the corner of a card it overlays.
  decorators: [
    (Story) => (
      <Box
        sx={{
          position: "relative",
          width: 280,
          height: 120,
          bgcolor: "placeholder",
          borderRadius: 1,
        }}
      >
        <Story />
      </Box>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof PendingBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// How call sites compose the pair: the badge overlays the card while
// pendingCardSx dims it and blocks clicks until the ingester catches up.
const PendingCard = ({ pending }: { pending: boolean }) => (
  <Card sx={{ position: "relative", width: 280 }}>
    <CardActionArea sx={pendingCardSx(pending)}>
      <CardContent sx={{ height: 120 }}>
        <Typography variant="h4">Observation</Typography>
        <Typography variant="body2" color="text.secondary">
          {pending ? "Waiting for the ingester" : "Ingested"}
        </Typography>
      </CardContent>
    </CardActionArea>
    {pending && <PendingBadge />}
  </Card>
);

export const OnPendingCard: Story = {
  parameters: { layout: "padded" },
  render: () => <PendingCard pending />,
};

export const SettledCard: Story = {
  render: () => <PendingCard pending={false} />,
};
