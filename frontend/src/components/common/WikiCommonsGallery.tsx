import { useEffect, useState } from "react";
import {
  Box,
  ImageList,
  ImageListItem,
  ImageListItemBar,
  Typography,
  Link as MuiLink,
  CircularProgress,
} from "@mui/material";

interface CommonsImage {
  thumbUrl: string;
  pageUrl: string;
  artist?: string | undefined;
  license?: string | undefined;
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Strip HTML tags and decode HTML entities (e.g. &amp; → &) */
export function decodeHtmlText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(\w+));/g, (match, dec, hex, named) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return HTML_ENTITIES[`&${named};`] ?? match;
    })
    .trim();
}

async function fetchCommonsImages(
  taxonName: string,
  limit: number,
): Promise<CommonsImage[]> {
  const category = `Category:${taxonName.replace(/ /g, "_")}`;

  // Step 1: Get file names from the category
  const listResp = await fetch(
    `https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${encodeURIComponent(category)}&cmtype=file&cmlimit=${limit}&format=json&origin=*`,
  );
  if (!listResp.ok) return [];
  const listData = await listResp.json();
  const members = listData?.query?.categorymembers;
  if (!members || members.length === 0) return [];

  // Step 2: Get thumbnail URLs and metadata
  const titles = members.map((m: { title: string }) => m.title).join("|");
  const infoResp = await fetch(
    `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=400&format=json&origin=*`,
  );
  if (!infoResp.ok) return [];
  const infoData = await infoResp.json();
  const pages = infoData?.query?.pages;
  if (!pages) return [];

  return Object.values(pages)
    .filter((p: any) => p.imageinfo?.[0]?.thumburl)
    .map((p: any) => {
      const info = p.imageinfo[0];
      const meta = info.extmetadata || {};
      const artistHtml = meta.Artist?.value || "";
      const artist = decodeHtmlText(artistHtml);
      return {
        thumbUrl: info.thumburl,
        pageUrl: info.descriptionurl,
        artist: artist || undefined,
        license: meta.LicenseShortName?.value || undefined,
      };
    });
}

interface WikiCommonsGalleryProps {
  taxonName: string;
  limit?: number;
}

export function WikiCommonsGallery({
  taxonName,
  limit = 12,
}: WikiCommonsGalleryProps) {
  const [images, setImages] = useState<CommonsImage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCommonsImages(taxonName, limit).then((result) => {
      if (!cancelled) {
        setImages(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [taxonName, limit]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (images.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No images found on Wikimedia Commons.
      </Typography>
    );
  }

  return (
    <Box>
      <ImageList variant="masonry" cols={3} gap={8} sx={{ m: 0 }}>
        {images.map((img, idx) => (
          <ImageListItem key={idx}>
            <MuiLink
              href={img.pageUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                src={img.thumbUrl}
                alt={`Wikimedia Commons image ${idx + 1}`}
                loading="lazy"
                style={{ borderRadius: 4, display: "block", width: "100%" }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </MuiLink>
            {img.artist && (
              <ImageListItemBar
                subtitle={
                  <>
                    {img.artist}
                    {img.license && (
                      <Typography
                        component="span"
                        sx={{ ml: 0.5, opacity: 0.7, fontSize: "inherit" }}
                      >
                        ({img.license})
                      </Typography>
                    )}
                  </>
                }
                sx={{
                  borderRadius: "0 0 4px 4px",
                  "& .MuiImageListItemBar-subtitle": {
                    fontSize: "0.65rem",
                  },
                }}
              />
            )}
          </ImageListItem>
        ))}
      </ImageList>
      <MuiLink
        href={`https://commons.wikimedia.org/wiki/Category:${taxonName.replace(/ /g, "_")}`}
        target="_blank"
        rel="noopener noreferrer"
        variant="caption"
        sx={{ mt: 1, display: "block" }}
      >
        View all on Wikimedia Commons
      </MuiLink>
    </Box>
  );
}
