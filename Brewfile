# Homebrew bundle for local development on macOS.
# Install everything with: brew bundle
#
# Linux contributors: see docs/development.md for distro-equivalent
# packages.

# Toolchain
brew "node@24"
brew "rustup"            # `rustup` manages Rust per rust-toolchain.toml
brew "go"                # for building the upstream `tap` binary

# Service orchestration. process-compose ships via the upstream tap,
# not core homebrew — see https://github.com/F1bonacc1/process-compose.
tap "f1bonacc1/tap"
brew "f1bonacc1/tap/process-compose"

# Database. brew's `postgis` formula pulls in the matching postgresql
# formula as a dependency, so installing postgis is enough.
brew "postgis"

# species-id native dependency
brew "onnxruntime"
