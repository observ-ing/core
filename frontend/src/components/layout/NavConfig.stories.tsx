import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, List, ListItem, ListItemIcon, ListItemText, Stack, Typography } from "@mui/material";
import { getNavItems, getThemeIcon } from "./NavConfig";
import type { ThemeMode } from "../../store/uiSlice";

/**
 * NavConfig exports two helpers used by `Sidebar` / `TopBar`. Stories
 * render the helper output in a simple list so the visual content of
 * each variant is browsable.
 */
const meta = {
  title: "Layout/NavConfig",
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function NavItemList({ user, unreadCount }: { user: { did: string } | null; unreadCount: number }) {
  return (
    <List>
      {getNavItems(user, unreadCount).map((item) => (
        <ListItem key={item.path}>
          <ListItemIcon>{item.icon}</ListItemIcon>
          <ListItemText primary={item.label} secondary={item.path} />
        </ListItem>
      ))}
    </List>
  );
}

export const SignedOut: Story = {
  render: () => <NavItemList user={null} unreadCount={0} />,
};

export const SignedInNoUnread: Story = {
  render: () => <NavItemList user={{ did: "did:plc:alice" }} unreadCount={0} />,
};

export const SignedInWithUnread: Story = {
  render: () => <NavItemList user={{ did: "did:plc:alice" }} unreadCount={3} />,
};

export const ThemeIcons: Story = {
  render: () => (
    <Stack direction="row" spacing={3} sx={{ alignItems: "center" }}>
      {(["light", "dark", "system"] satisfies ThemeMode[]).map((mode) => (
        <Box key={mode} sx={{ textAlign: "center" }}>
          <Box>{getThemeIcon(mode)}</Box>
          <Typography variant="caption">{mode}</Typography>
        </Box>
      ))}
    </Stack>
  ),
};
