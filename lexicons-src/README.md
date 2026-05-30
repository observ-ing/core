# Lexicon sources (MLF)

These `.mlf` files are the **source of truth** for the project's AT Protocol
lexicons. They are written in [MLF](https://mlf.lol) ("Matt's Lexicon Format"),
a human-friendly DSL that compiles to ATProto lexicon JSON.

```
lexicons-src/**/*.mlf   →  lexicons/**/*.json  →  crates/observing-lexicons/src/**
     (edit these)            (generated JSON)         (generated Rust types)
```

## Editing

1. Edit the `.mlf` files here. The file path determines the lexicon NSID
   (e.g. `ing/observ/temp/comment.mlf` → `ing.observ.temp.comment`).
2. Regenerate the JSON and Rust types:

   ```bash
   npm run generate-lexicons
   cargo fmt -p observing-lexicons
   ```

3. Commit the `.mlf` edits together with the regenerated `lexicons/*.json`
   and `crates/observing-lexicons/src/`. CI (`rust-lexicons-check`) fails on
   any drift between these sources and their generated output.

Do **not** hand-edit `lexicons/*.json` — it is generated.

## Layout

| File | NSID |
|------|------|
| `ing/observ/temp/*.mlf` | `ing.observ.temp.*` — social records (comment, like, interaction) |
| `bio/lexicons/temp/v0-1/*.mlf` | `bio.lexicons.temp.v0-1.*` — Darwin Core biodiversity records |
| `com/atproto/repo/strongRef.mlf` | the vendored `com.atproto.repo.strongRef` standard type |

## Why explicit `mlf` commands (no `mlf.toml`)?

MLF's project mode (`mlf.toml`) scopes a project to a single `[package].name`
NSID prefix. This repo legitimately owns two first-party roots
(`ing.observ.*` and `bio.lexicons.*`) plus the vendored `com.atproto.*` type,
so no single package prefix covers them. `scripts/generate-lexicons.sh`
therefore drives `mlf` with explicit `--root lexicons-src`, which derives each
NSID from its path and is namespace-agnostic.
