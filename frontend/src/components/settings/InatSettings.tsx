import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, FormControlLabel, Stack, Switch, Typography } from "@mui/material";
import { startInatLink } from "../../services/api";
import { getErrorMessage } from "../../lib/utils";
import { useToast } from "../../hooks/useToast";
import { useInatAccount, useUserPreferences } from "../../lib/query/hooks";
import {
  type PreferencesPatch,
  useUnlinkInatAccount,
  useUpdatePreferences,
} from "../../lib/query/mutations";
import { SettingsSection } from "./SettingsSection";

/**
 * The appview sends the user back from iNaturalist's authorize page with one
 * of these, to say how linking went.
 */
const LINK_OUTCOMES = [
  { param: "inat-linked", type: "success", message: "iNaturalist account connected" },
  { param: "inat-error", type: "error", message: "Couldn't connect your iNaturalist account" },
] as const;

/**
 * Settings section for linking an iNaturalist account, so observations can be
 * posted there too. Renders nothing when the server has cross-posting off.
 */
export function InatSettings() {
  const toast = useToast();
  const { data: account } = useInatAccount();
  const unlink = useUnlinkInatAccount();
  const { data: prefs } = useUserPreferences();
  const updatePrefs = useUpdatePreferences();
  const [connecting, setConnecting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const reported = useRef(false);

  useEffect(() => {
    const outcome = LINK_OUTCOMES.find(({ param }) => searchParams.get(param) === "1");
    // The ref keeps StrictMode's double effect run from toasting twice.
    if (!outcome || reported.current) return;
    reported.current = true;
    toast[outcome.type](outcome.message);
    // Drop the marker so a reload doesn't report it again.
    const next = new URLSearchParams(searchParams);
    next.delete(outcome.param);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, toast]);

  if (!account?.enabled) return null;

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { url } = await startInatLink();
      window.location.assign(url);
    } catch (error) {
      setConnecting(false);
      toast.error(getErrorMessage(error, "Couldn't start connecting to iNaturalist"));
    }
  };

  const savePref = (patch: PreferencesPatch) => {
    // The hook applies the change optimistically and rolls back on error.
    updatePrefs.mutate(patch, {
      onError: (error) => toast.error(getErrorMessage(error, "Failed to save preference")),
    });
  };
  // Unset means off for posting, and on for requiring photos.
  const autoPost = prefs?.crosspostInaturalist === true;
  const requirePhotos = prefs?.crosspostInaturalistRequirePhotos ?? true;

  const handleDisconnect = () => {
    unlink.mutate(undefined, {
      onError: (error) => toast.error(getErrorMessage(error, "Couldn't disconnect iNaturalist")),
    });
  };

  return (
    <SettingsSection
      title="iNaturalist"
      description={
        <>
          Connect your iNaturalist account to post observations there too, as you upload them or
          later from an observation's details. Each one is posted once: later edits here don't
          change it there, and nothing comes back from iNaturalist. Posting adds a public link to
          the iNaturalist observation, so anyone can follow it to your iNaturalist account. Photos
          get your iNaturalist default license.
        </>
      }
      sx={{ mt: 3 }}
    >
      {account.login ? (
        <Stack spacing={1}>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <Typography variant="body2">Connected as {account.login}</Typography>
            <Button
              variant="outlined"
              color="inherit"
              size="small"
              onClick={handleDisconnect}
              disabled={unlink.isPending}
            >
              Disconnect
            </Button>
          </Stack>
          <FormControlLabel
            control={
              <Switch
                checked={autoPost}
                onChange={(_, checked) => savePref({ crosspostInaturalist: checked })}
              />
            }
            label="Post new observations to iNaturalist"
          />
          <FormControlLabel
            control={
              <Switch
                checked={requirePhotos}
                disabled={!autoPost}
                onChange={(_, checked) => savePref({ crosspostInaturalistRequirePhotos: checked })}
              />
            }
            label="Only observations with photos"
          />
        </Stack>
      ) : (
        <Button variant="contained" onClick={handleConnect} disabled={connecting}>
          Connect iNaturalist
        </Button>
      )}
    </SettingsSection>
  );
}
