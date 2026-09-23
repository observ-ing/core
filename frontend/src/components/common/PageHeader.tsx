import { Typography } from "@mui/material";

export interface PageHeaderProps {
  title: string;
  /** Short description shown below the title. Omit for a title-only header. */
  subtitle?: string;
}

/**
 * Title + optional description for a simple content page, shared by
 * DocsPage/TransparencyPage so their headers can't drift apart in
 * size/weight/spacing the way they previously did.
 */
export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 3 }}>
          {subtitle}
        </Typography>
      )}
    </>
  );
}
