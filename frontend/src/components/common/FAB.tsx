import { useState } from "react";
import {
  Backdrop,
  SpeedDial,
  SpeedDialAction,
  SpeedDialIcon,
  useMediaQuery,
  type Theme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useAppSelector } from "../../store";
import { useCreateActions } from "../../hooks/useCreateActions";
import { cornerPinSx } from "./layoutSx";

export function FAB() {
  const user = useAppSelector((state) => state.auth.user);
  // Controlled open state so we can force the speed-dial closed when an action
  // opens a modal, and keep it closed when focus returns to the FAB after that
  // modal closes (see onOpen below).
  const [open, setOpen] = useState(false);
  // Listed from the dial upward: the ways to create observations sit nearest it.
  const actions = useCreateActions();
  // Wide screens get the same actions from the top bar's "Add observation"
  // split button instead (see CreateMenu).
  const isDesktop = useMediaQuery((theme: Theme) => theme.breakpoints.up("md"));

  if (!user || isDesktop) {
    return null;
  }

  // The labels stay up while the dial is open, so nobody has to hover or
  // long-press to learn what an icon does. The backdrop keeps them legible over
  // the page, and covers the top bar along with it.
  const raised = (theme: Theme) => theme.zIndex.drawer + 2;

  return (
    <>
      <Backdrop
        open={open}
        onClick={() => setOpen(false)}
        sx={(theme) => ({ zIndex: raised(theme) })}
      />
      <SpeedDial
        ariaLabel="Create actions"
        icon={<SpeedDialIcon icon={<AddIcon />} />}
        direction="up"
        open={open}
        // Ignore the "focus" reason: MUI re-opens the dial when focus returns to
        // it after a modal we launched closes, which is the reopen bug. Click
        // ("toggle") and hover ("mouseEnter") still open it.
        onOpen={(_event, reason) => {
          if (reason !== "focus") setOpen(true);
        }}
        onClose={() => setOpen(false)}
        sx={[
          cornerPinSx("bottom-right", { size: "lg", position: "fixed" }),
          (theme) => ({ zIndex: open ? raised(theme) + 1 : 100 }),
        ]}
      >
        {actions.map((action) => (
          <SpeedDialAction
            key={action.name}
            icon={action.icon}
            slotProps={{
              tooltip: { open: true, title: action.name },
              // The label is positioned against the action, so it would wrap at
              // the action's width without this.
              staticTooltipLabel: { sx: { whiteSpace: "nowrap" } },
            }}
            // Close first, or the backdrop stays up over the modal or next page.
            onClick={() => {
              setOpen(false);
              action.action();
            }}
          />
        ))}
      </SpeedDial>
    </>
  );
}
