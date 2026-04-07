import {
  Box,
  Container,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Paper,
} from "@mui/material";
import { LightMode, DarkMode, SettingsBrightness } from "@mui/icons-material";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useAppDispatch, useAppSelector } from "../../store";
import { setThemeMode, type ThemeMode } from "../../store/uiSlice";

export function SettingsPage() {
  usePageTitle("Settings");
  const dispatch = useAppDispatch();
  const themeMode = useAppSelector((state) => state.ui.themeMode);

  const handleThemeChange = (_: React.MouseEvent<HTMLElement>, value: ThemeMode | null) => {
    if (value) dispatch(setThemeMode(value));
  };

  return (
    <Box sx={{ flex: 1, overflow: "auto", height: "100%" }}>
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Typography variant="h5" fontWeight={700} sx={{ mb: 3 }}>
          Settings
        </Typography>

        <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
            Appearance
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose how Observ.ing looks to you. Select a single theme, or sync with your system
            settings.
          </Typography>
          <ToggleButtonGroup
            value={themeMode}
            exclusive
            onChange={handleThemeChange}
            aria-label="Theme mode"
            sx={{
              "& .MuiToggleButton-root": {
                px: 3,
                py: 1,
                gap: 1,
                textTransform: "none",
                fontWeight: 500,
              },
            }}
          >
            <ToggleButton value="light" aria-label="Light mode">
              <LightMode fontSize="small" />
              Light
            </ToggleButton>
            <ToggleButton value="dark" aria-label="Dark mode">
              <DarkMode fontSize="small" />
              Dark
            </ToggleButton>
            <ToggleButton value="system" aria-label="System theme">
              <SettingsBrightness fontSize="small" />
              System
            </ToggleButton>
          </ToggleButtonGroup>
        </Paper>
      </Container>
    </Box>
  );
}
