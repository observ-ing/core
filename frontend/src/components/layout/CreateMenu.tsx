import { useState } from "react";
import { Button, ButtonGroup, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import { Add, KeyboardArrowDown } from "@mui/icons-material";
import { headerMenuPaperSx, pillButtonSx } from "../common/layoutSx";
import { useAppSelector } from "../../store";
import { useCreateActions } from "../../hooks/useCreateActions";

/**
 * The top bar's primary "Add observation" split button: the wide-screen
 * counterpart of the mobile speed dial (FAB), offering the same create actions.
 * The button itself starts a new observation; the arrow holds the rest.
 */
export function CreateMenu() {
  const user = useAppSelector((state) => state.auth.user);
  const [primary, ...others] = useCreateActions();
  // The menu hangs from the whole group, not just the arrow.
  const [groupEl, setGroupEl] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  if (!user || !primary) {
    return null;
  }

  const close = () => setOpen(false);

  return (
    <>
      <ButtonGroup
        ref={setGroupEl}
        variant="contained"
        disableElevation
        aria-label="Create actions"
        sx={{ "& .MuiButton-root": { fontWeight: 700, whiteSpace: "nowrap" } }}
      >
        {/* Rounded like the TopBar's "Log in" button. Set per button, not on the
            group, so the group's own rule still squares the corners where the
            two meet. */}
        <Button startIcon={<Add />} onClick={primary.action} sx={{ ...pillButtonSx, px: 2 }}>
          Add observation
        </Button>
        {/* With nothing else on offer (e.g. the native app), skip the arrow. */}
        {others.length > 0 && (
          <Button
            id="create-menu-button"
            aria-label="More create options"
            aria-haspopup="menu"
            aria-controls={open ? "create-menu" : undefined}
            aria-expanded={open ? "true" : undefined}
            onClick={() => setOpen((prev) => !prev)}
            sx={{ ...pillButtonSx, px: 0.5, minWidth: 0 }}
          >
            <KeyboardArrowDown />
          </Button>
        )}
      </ButtonGroup>
      <Menu
        id="create-menu"
        anchorEl={groupEl}
        open={open}
        onClose={close}
        slotProps={{
          list: { "aria-labelledby": "create-menu-button" },
          paper: {
            elevation: 4,
            sx: {
              mt: 1,
              ...headerMenuPaperSx,
            },
          },
        }}
        transformOrigin={{ horizontal: "left", vertical: "top" }}
        anchorOrigin={{ horizontal: "left", vertical: "bottom" }}
      >
        {others.map((action) => (
          <MenuItem
            key={action.name}
            onClick={() => {
              close();
              action.action();
            }}
          >
            <ListItemIcon>{action.icon}</ListItemIcon>
            <ListItemText primary={action.name} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
