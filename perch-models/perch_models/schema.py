"""Pydantic models for the Perch pipeline's data shapes.

Validates external data at its entry points:
  - Perch's bundled class CSV is parsed into PerchClassRecord
  - GBIF enrichment responses parse through GbifMatch
  - Final on-disk artifacts validate against ClassRecord (`species_labels.json`).

Internal flow uses list[ClassRecord] instead of list[dict].
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class PerchClassRecord(BaseModel):
    """One row of the upstream Perch class list, as published with the model.

    Perch ships its class list as a CSV with an eBird code or scientific
    name per row, plus a `class_type` distinguishing species from general
    sound events. We normalize on parse so downstream code never has to
    care about the upstream column layout again.
    """

    model_config = ConfigDict(populate_by_name=True)

    # Index in the ONNX output head (0-based). MUST match row order on disk.
    index: int = Field(ge=0)
    scientific_name: str = Field(min_length=1)
    # True for biological taxa (~14,795 entries); False for the ~200
    # "general sound events" (rain, wind, chainsaw, gunshot, etc.).
    is_species: bool


class ClassRecord(BaseModel):
    """One class in the final label set. Persisted as species_labels.json.

    Shape matches `bioclip-models`' SpeciesRecord so the Rust loader can
    use the same deserialization path. Adds `is_species` so the service
    can filter sound events out of returned suggestions.
    """

    model_config = ConfigDict(populate_by_name=True)

    scientific_name: str = Field(alias="scientificName", min_length=1)
    common_name: str | None = Field(default=None, alias="commonName")
    kingdom: str | None = None
    phylum: str | None = None
    class_: str | None = Field(default=None, alias="class")
    order: str | None = None
    family: str | None = None
    genus: str | None = None
    is_species: bool = Field(default=True, alias="isSpecies")


# --- GBIF API response boundary ---


class GbifMatch(BaseModel):
    """Partial GBIF species-match response — only the fields we read."""

    model_config = ConfigDict(extra="ignore")

    match_type: str | None = Field(default=None, alias="matchType")
    usage_key: int | None = Field(default=None, alias="usageKey")
    scientific_name: str | None = Field(default=None, alias="scientificName")
    canonical_name: str | None = Field(default=None, alias="canonicalName")
    rank: str | None = None
    kingdom: str | None = None
    phylum: str | None = None
    class_: str | None = Field(default=None, alias="class")
    order: str | None = None
    family: str | None = None
    genus: str | None = None


class GbifVernacularName(BaseModel):
    """One vernacular-name entry from GBIF."""

    model_config = ConfigDict(extra="ignore")

    vernacular_name: str = Field(alias="vernacularName")
    language: str | None = None
    preferred: bool = False


class GbifVernacularResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    results: list[GbifVernacularName] = Field(default_factory=list)
