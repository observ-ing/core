"""CLI entry point for the Perch model preparation pipeline."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def cmd_prepare(args: argparse.Namespace) -> None:
    """Run the full prep pipeline: download bundle → enrich labels → verify."""
    from .download import download_bundle
    from .labels import enrich_with_gbif, parse_perch_labels, save_class_list
    from .verify import verify_all

    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    onnx_path = output_dir / "audio_encoder.onnx"
    labels_csv = output_dir / "labels.csv"
    final_labels = output_dir / "species_labels.json"

    # Step 1: Fetch ONNX + raw class list, unless cached.
    if onnx_path.exists() and labels_csv.exists() and args.skip_download:
        print(f"Skipping download (existing: {onnx_path}, {labels_csv})")
    else:
        download_bundle(output_dir)

    # Step 2: Parse raw class list.
    perch_classes = parse_perch_labels(labels_csv)

    # Step 3: Enrich with GBIF kingdom + common name (optional, slow).
    if final_labels.exists() and not args.rebuild_labels:
        print(f"Using existing enriched labels: {final_labels}")
    elif args.skip_gbif:
        # Pass-through: copy scientific names with no enrichment.
        from .schema import ClassRecord
        passthrough = [
            ClassRecord(scientific_name=r.scientific_name, is_species=r.is_species)
            for r in perch_classes
        ]
        save_class_list(passthrough, final_labels)
    else:
        enriched = enrich_with_gbif(perch_classes)
        save_class_list(enriched, final_labels)

    # Step 4: (optional) Geo index from iNat Open Range Maps.
    if args.range_maps:
        # Stub — implementation mirrors bioclip-models/geo.py but keys on
        # Perch's class indices instead of GBIF usageKeys. Lift that
        # module verbatim once the species_labels.json layout stabilizes.
        print(f"  TODO build geo index from {args.range_maps}")

    # Step 5: Verify.
    if not args.skip_verify:
        print("\n--- Verification ---")
        verify_all(output_dir)

    print(f"\nDone! Output in {output_dir}/")
    for f in sorted(output_dir.iterdir()):
        if f.is_file():
            size_mb = f.stat().st_size / (1024 * 1024)
            print(f"  {f.name}: {size_mb:.1f} MB")


def cmd_download(args: argparse.Namespace) -> None:
    """Just fetch the prebuilt ONNX + class list (no enrichment)."""
    from .download import download_bundle

    download_bundle(args.output_dir)


def cmd_labels(args: argparse.Namespace) -> None:
    """Build the enriched species_labels.json without touching the model."""
    from .labels import enrich_with_gbif, parse_perch_labels, save_class_list

    perch_classes = parse_perch_labels(args.labels_csv)
    enriched = enrich_with_gbif(perch_classes)
    save_class_list(enriched, args.output)


def cmd_verify(args: argparse.Namespace) -> None:
    """Verify exported model artifacts."""
    from .verify import verify_all

    verify_all(args.model_dir)


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="perch-prepare",
        description="Perch 2.0 model preparation pipeline for Observ.ing",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # --- prepare ---
    p_prep = subparsers.add_parser(
        "prepare",
        help="Full pipeline: download Perch bundle, enrich labels via GBIF, verify",
    )
    p_prep.add_argument("--output-dir", type=Path, default=Path("output"))
    p_prep.add_argument("--skip-download", action="store_true",
                        help="Skip download if files already exist")
    p_prep.add_argument("--skip-gbif", action="store_true",
                        help="Skip GBIF enrichment (faster; suggestions will lack kingdom/commonName)")
    p_prep.add_argument("--skip-verify", action="store_true")
    p_prep.add_argument("--rebuild-labels", action="store_true",
                        help="Re-run GBIF enrichment even if species_labels.json exists")
    p_prep.add_argument("--range-maps", type=Path, default=None,
                        help="iNat Open Range Map file; if set, also builds species_geo_index.bin")
    p_prep.set_defaults(func=cmd_prepare)

    # --- download ---
    p_dl = subparsers.add_parser("download", help="Fetch the Perch ONNX bundle")
    p_dl.add_argument("--output-dir", type=Path, default=Path("output"))
    p_dl.set_defaults(func=cmd_download)

    # --- labels ---
    p_lbl = subparsers.add_parser("labels", help="Enrich Perch's class list via GBIF")
    p_lbl.add_argument("--labels-csv", type=Path, required=True,
                       help="Raw Perch class list CSV")
    p_lbl.add_argument("--output", type=Path, default=Path("output/species_labels.json"))
    p_lbl.set_defaults(func=cmd_labels)

    # --- verify ---
    p_v = subparsers.add_parser("verify", help="Verify exported artifacts")
    p_v.add_argument("model_dir", type=Path)
    p_v.set_defaults(func=cmd_verify)

    args = parser.parse_args()
    try:
        args.func(args)
    except KeyboardInterrupt:
        print("\nAborted.")
        sys.exit(1)
    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        sys.exit(1)
