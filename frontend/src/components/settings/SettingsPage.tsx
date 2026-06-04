import {
  Box,
  Container,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  type SelectChangeEvent,
} from "@mui/material";
import { LightMode, DarkMode, SettingsBrightness } from "@mui/icons-material";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useToast } from "../../hooks/useToast";
import { useAppDispatch, useAppSelector } from "../../store";
import { setThemeMode, type ThemeMode } from "../../store/uiSlice";
import { useUserPreferences } from "../../lib/query/hooks";
import { useUpdatePreferences } from "../../lib/query/mutations";
import { LICENSE_OPTIONS } from "../../lib/licenses";

const NO_DEFAULT = "__none__";

export function SettingsPage() {
  usePageTitle("Settings");
  const dispatch = useAppDispatch();
  const toast = useToast();
  const themeMode = useAppSelector((state) => state.ui.themeMode);
  const user = useAppSelector((state) => state.auth.user);
  const { data: prefs } = useUserPreferences();
  const defaultLicense = prefs?.defaultLicense ?? null;
  const updatePrefs = useUpdatePreferences();

  const handleThemeChange = (_: React.MouseEvent<HTMLElement>, value: ThemeMode | null) => {
    if (value) dispatch(setThemeMode(value));
  };

  const handleLicenseChange = (e: SelectChangeEvent<string>) => {
    const raw = e.target.value;
    const next = raw === NO_DEFAULT ? null : raw;
    // The hook applies the change optimistically and rolls back on error.
    updatePrefs.mutate(
      { defaultLicense: next },
      {
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Failed to save preference"),
      },
    );
  };

  return (
    <Box sx={{ flex: 1, overflow: "auto", height: "100%" }}>
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Typography
          variant="h5"
          sx={{
            fontWeight: 700,
            mb: 3,
          }}
        >
          Settings
        </Typography>

        <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, mb: 3 }}>
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 600,
              mb: 0.5,
            }}
          >
            Appearance
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 2,
            }}
          >
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

        {user && (
          <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
              Upload defaults
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
              Pre-fill the license for new observation photos. You can still change it on each
              upload.
            </Typography>
            <FormControl fullWidth size="small" disabled={updatePrefs.isPending}>
              <InputLabel id="default-license-label">Default license</InputLabel>
              <Select
                labelId="default-license-label"
                value={defaultLicense ?? NO_DEFAULT}
                label="Default license"
                onChange={handleLicenseChange}
              >
                <MenuItem value={NO_DEFAULT}>No default (use CC BY)</MenuItem>
                {LICENSE_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Paper>
        )}
      </Container>
    </Box>
  );
}
