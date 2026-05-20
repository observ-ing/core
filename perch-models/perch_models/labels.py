"""Parse Perch's class list and enrich it with GBIF taxonomy / common names.

The upstream class list is index-aligned with the ONNX output head, so the
output `species_labels.json` MUST preserve that ordering. We sort by the
`index` column on parse and verify there are no gaps.

GBIF enrichment is best-effort: rows that don't match a GBIF backbone
entry keep their original scientific name but omit `kingdom` / `commonName`.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

from .schema import ClassRecord, GbifMatch, GbifVernacularResponse, PerchClassRecord

# Generic sound-event labels Perch emits alongside species. Kept as constants
# (rather than substring matches against the label text) because the
# upstream label set is small and stable — and a substring rule risks
# misclassifying real taxa (e.g. the *species* "Tundra Swan" vs the
# *sound event* "wind").
GENERAL_SOUND_EVENT_PREFIXES = ("event:", "noise:", "sfx:")


def parse_perch_labels(csv_path: Path) -> list[PerchClassRecord]:
    """Read the upstream CSV into validated records, sorted by class index.

    Expected columns (Justin Chu's bundle, subject to revision):
        index,label,class_type
    where `label` is a scientific name for species rows or an event tag
    (e.g. "event:rain") for general sound events.
    """
    records: list[PerchClassRecord] = []
    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            label = row["label"].strip()
            is_event = any(label.startswith(p) for p in GENERAL_SOUND_EVENT_PREFIXES)
            class_type = row.get("class_type", "").strip().lower()
            is_species = (class_type == "species") if class_type else (not is_event)
            records.append(
                PerchClassRecord(
                    index=int(row["index"]),
                    scientific_name=label,
                    is_species=is_species,
                )
            )

    records.sort(key=lambda r: r.index)
    # Verify the class indices are dense 0..N-1; gaps would silently
    # misalign with the ONNX output head and corrupt every prediction.
    for expected, r in enumerate(records):
        if r.index != expected:
            raise ValueError(
                f"Class index gap at row {expected}: got {r.index}. "
                "Output head ordering must be contiguous."
            )

    print(f"Parsed {len(records)} Perch classes "
          f"({sum(1 for r in records if r.is_species)} species)")
    return records


def enrich_with_gbif(records: list[PerchClassRecord]) -> list[ClassRecord]:
    """Look each species name up in GBIF and merge taxonomy + common name.

    Sound-event rows skip the lookup entirely. Failed matches keep the
    original scientific name and emit empty kingdom/commonName.

    Requires the `gbif` extra. Synchronous + rate-limited — ~15k species
    against api.gbif.org's free tier runs in 30–60 minutes; a cached
    `gbif_cache.json` next to the labels file short-circuits reruns.
    """
    import httpx
    from tenacity import retry, stop_after_attempt, wait_exponential

    cache_path = Path("cache/gbif_cache.json")
    cache: dict[str, dict[str, object]] = {}
    if cache_path.exists():
        cache = json.loads(cache_path.read_text())

    client = httpx.Client(base_url="https://api.gbif.org/v1", timeout=10)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
    def gbif_match(name: str) -> GbifMatch | None:
        if name in cache:
            return GbifMatch.model_validate(cache[name])
        r = client.get("/species/match", params={"name": name, "strict": "true"})
        r.raise_for_status()
        m = GbifMatch.model_validate(r.json())
        if m.usage_key is not None:
            cache[name] = m.model_dump(by_alias=True, exclude_none=True)
        return m

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
    def vernacular(usage_key: int) -> str | None:
        r = client.get(f"/species/{usage_key}/vernacularNames")
        r.raise_for_status()
        v = GbifVernacularResponse.model_validate(r.json())
        # Prefer English names flagged `preferred=true`; fall back to the
        # first English name; finally any name at all.
        en = [n for n in v.results if (n.language or "").lower() == "eng"]
        preferred = next((n for n in en if n.preferred), None)
        chosen = preferred or (en[0] if en else (v.results[0] if v.results else None))
        return chosen.vernacular_name if chosen else None

    enriched: list[ClassRecord] = []
    for i, r in enumerate(records):
        if not r.is_species:
            enriched.append(
                ClassRecord(scientific_name=r.scientific_name, is_species=False)
            )
            continue
        try:
            m = gbif_match(r.scientific_name)
        except Exception as e:
            print(f"  GBIF match failed for {r.scientific_name!r}: {e}")
            m = None
        common_name: str | None = None
        if m and m.usage_key is not None:
            try:
                common_name = vernacular(m.usage_key)
            except Exception as e:
                print(f"  Vernacular lookup failed for usage_key={m.usage_key}: {e}")

        enriched.append(
            ClassRecord(
                scientific_name=(m.canonical_name if m and m.canonical_name else r.scientific_name),
                common_name=common_name,
                kingdom=m.kingdom if m else None,
                phylum=m.phylum if m else None,
                class_=m.class_ if m else None,
                order=m.order if m else None,
                family=m.family if m else None,
                genus=m.genus if m else None,
                is_species=True,
            )
        )

        # Periodically flush the cache so a long run isn't lost on Ctrl-C.
        if i % 500 == 0 and i > 0:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(cache))
            print(f"  Enriched {i}/{len(records)} (cache flushed)")

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache))
    return enriched


def save_class_list(records: list[ClassRecord], output_path: Path) -> None:
    """Write the final label set to disk in the shape the Rust loader expects."""
    serialized = [r.model_dump(by_alias=True, exclude_none=True) for r in records]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(serialized, indent=2))
    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"  Saved {len(records)} classes to {output_path} ({size_mb:.2f} MB)")
