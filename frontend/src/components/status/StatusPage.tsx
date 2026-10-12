import { Chip, List, ListItem, ListItemText, Paper, Stack, Typography } from "@mui/material";
import type { ChipProps } from "@mui/material";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useServiceStatus } from "../../lib/query/hooks";
import type { ServiceState, ServiceStatus } from "../../services/api";
import { CenteredSpinner } from "../common/CenteredSpinner";
import { EmptyState } from "../common/EmptyState";
import { PageContainer } from "../common/PageContainer";
import { PageHeader } from "../common/PageHeader";
import { RelativeTime } from "../common/RelativeTime";

const STATE_LABELS: Record<ServiceState, string> = {
  awake: "Awake",
  asleep: "Asleep",
  up: "Up",
  down: "Down",
};

const STATE_COLORS: Record<ServiceState, ChipProps["color"]> = {
  awake: "success",
  asleep: "default",
  up: "success",
  down: "error",
};

function instanceSummary({ instances, activeInstances }: ServiceStatus): string | null {
  if (instances === undefined) return null;
  if (instances === 0) return "No instances";
  const total = `${instances} ${instances === 1 ? "instance" : "instances"}`;
  return activeInstances ? `${total}, ${activeInstances} busy` : total;
}

export function StatusPage() {
  usePageTitle("Status");
  const { data, isPending, isError, error } = useServiceStatus();

  return (
    <PageContainer maxWidth="sm">
      <PageHeader
        title="Status"
        subtitle="Which parts of Observ.ing are running right now. To save money, most services scale down to nothing when no one is using them (asleep) and start back up on the next request."
      />

      <Paper variant="outlined">
        {isPending ? (
          <CenteredSpinner />
        ) : isError ? (
          <EmptyState message={error.message} p={3} />
        ) : (
          <List disablePadding>
            {data.services.map((service, i) => {
              const summary = instanceSummary(service);
              return (
                <ListItem
                  key={service.id}
                  divider={i < data.services.length - 1}
                  sx={{ alignItems: "flex-start", gap: 2 }}
                >
                  <ListItemText primary={service.name} secondary={service.description} />
                  <Stack spacing={0.5} sx={{ alignItems: "flex-end", flexShrink: 0, pt: 0.75 }}>
                    <Chip
                      size="small"
                      label={STATE_LABELS[service.state]}
                      color={STATE_COLORS[service.state]}
                    />
                    {summary && (
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {summary}
                      </Typography>
                    )}
                  </Stack>
                </ListItem>
              );
            })}
          </List>
        )}
      </Paper>

      {data && (
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 2 }}>
          Checked <RelativeTime date={new Date(data.checkedAt)} withAgo />. Instance counts trail by
          about 3 minutes. Loading this page wakes the website, so it always shows as awake here.
        </Typography>
      )}
    </PageContainer>
  );
}
