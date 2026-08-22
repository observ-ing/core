import type { ReactNode } from "react";
import {
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Paper,
  type SxProps,
  type Theme,
} from "@mui/material";
import { LightMode, DarkMode, SettingsBrightness } from "@mui/icons-material";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useToast } from "../../hooks/useToast";
import { useAppDispatch, useAppSelector } from "../../store";
import { setThemeMode, type ThemeMode } from "../../store/uiSlice";
import { useUserPreferences } from "../../lib/query/hooks";
import { useUpdatePreferences } from "../../lib/query/mutations";
import { PageContainer } from "../common/PageContainer";
import { LicenseSelect } from "../common/LicenseSelect";

const NO_DEFAULT = "__none__";

interface SettingsSectionProps {
  title: ReactNode;
  description: ReactNode;
  sx?: SxProps<Theme>;
  children: ReactNode;
}

/** Titled, outlined card wrapper shared by the settings page sections. */
function SettingsSection({ title, description, sx, children }: SettingsSectionProps) {
  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, ...sx }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
        {description}
      </Typography>
      {children}
    </Paper>
  );
}

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

  const handleLicenseChange = (raw: string) => {
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
    <PageContainer maxWidth="sm">
      <Typography
        variant="h5"
        sx={{
          fontWeight: 700,
          mb: 3,
        }}
      >
        Settings
      </Typography>

      <SettingsSection
        title="Appearance"
        description="Choose how Observ.ing looks to you. Select a single theme, or sync with your system settings."
        sx={{ mb: 3 }}
      >
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
      </SettingsSection>

      {user && (
        <SettingsSection
          title="Upload defaults"
          description="Pre-fill the license for new observation photos. You can still change it on each upload."
        >
          <LicenseSelect
            value={defaultLicense ?? NO_DEFAULT}
            onChange={handleLicenseChange}
            label="Default license"
            idPrefix="default-license"
            size="small"
            margin="none"
            disabled={updatePrefs.isPending}
            noneOption={{ value: NO_DEFAULT, label: "No default (use CC BY)" }}
          />
        </SettingsSection>
      )}
    </PageContainer>
  );
}
