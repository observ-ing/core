import { useEffect, useState } from "react";
import { Box } from "@mui/material";

const thumbnailCache = new Map<string, string | null>();

async function fetchWikipediaThumbnail(
  taxonName: string,
  size: number,
): Promise<string | null> {
  if (thumbnailCache.has(taxonName)) {
    return thumbnailCache.get(taxonName)!;
  }

  try {
    const title = taxonName.replace(/ /g, "_");
    const resp = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    );
    if (!resp.ok) {
      thumbnailCache.set(taxonName, null);
      return null;
    }
    const data = await resp.json();
    if (data.thumbnail?.source) {
      const url = data.thumbnail.source.replace(/\/\d+px-/, `/${size}px-`);
      thumbnailCache.set(taxonName, url);
      return url;
    }
    thumbnailCache.set(taxonName, null);
    return null;
  } catch {
    thumbnailCache.set(taxonName, null);
    return null;
  }
}

interface WikiTaxonThumbnailProps {
  name: string;
  size?: number;
}

export function WikiTaxonThumbnail({
  name,
  size = 24,
}: WikiTaxonThumbnailProps) {
  const [url, setUrl] = useState<string | null>(
    thumbnailCache.get(name) ?? null,
  );
  const [loaded, setLoaded] = useState(thumbnailCache.has(name));

  useEffect(() => {
    if (thumbnailCache.has(name)) {
      setUrl(thumbnailCache.get(name)!);
      setLoaded(true);
      return;
    }

    let cancelled = false;
    fetchWikipediaThumbnail(name, size * 2).then((result) => {
      if (!cancelled) {
        setUrl(result);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [name, size]);

  if (!loaded || !url) {
    return (
      <Box
        sx={{
          width: size,
          height: size,
          minWidth: size,
          borderRadius: "4px",
        }}
      />
    );
  }

  return (
    <Box
      component="img"
      src={url}
      alt=""
      sx={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: "4px",
        objectFit: "cover",
      }}
    />
  );
}
