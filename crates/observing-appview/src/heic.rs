//! HEIC/HEIF → JPEG conversion for photo import.
//!
//! Browsers other than Safari can't decode HEIC, so the frontend falls back to
//! this when it can't convert a picked photo itself (e.g. Chrome on Android).
//! Decoding is delegated to libheif's `heif-convert` CLI rather than linked in:
//! it keeps libheif (LGPL) and its codec plugins out of the build entirely, so
//! the appview compiles anywhere and only the runtime image needs the package.
//! A crashing or hanging decoder also takes down a child process instead of
//! the server.
//!
//! EXIF is handled by the frontend, which copies it from the original file
//! onto whatever JPEG comes back here, so this only has to get the pixels
//! right (libheif applies the HEIF rotation/mirror transforms).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tokio::sync::Semaphore;

/// JPEG quality for converted photos. High enough that species ID and
/// zooming in on detail don't suffer from a second generation of lossy
/// compression.
const JPEG_QUALITY: &str = "90";

/// A large phone HEIC decodes in well under a second; anything past this is a
/// pathological input.
const CONVERT_TIMEOUT: Duration = Duration::from_secs(30);

/// Decoding a 48MP photo holds a few hundred MB of raw pixels, so cap how many
/// run at once rather than letting a burst of uploads exhaust the instance.
const MAX_CONCURRENT_CONVERSIONS: usize = 2;

#[derive(Debug)]
pub enum ConvertError {
    /// The input doesn't look like a HEIF container at all.
    NotHeif,
    /// The converter binary isn't installed (e.g. a local dev machine without
    /// libheif).
    Unavailable,
    /// libheif rejected the file or produced no image.
    Decode(String),
    /// Anything else: temp files, timeouts, process spawning.
    Internal(String),
}

impl std::fmt::Display for ConvertError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotHeif => write!(f, "not a HEIF image"),
            Self::Unavailable => write!(f, "HEIC converter is not installed"),
            Self::Decode(msg) => write!(f, "HEIC decode failed: {msg}"),
            Self::Internal(msg) => write!(f, "{msg}"),
        }
    }
}

pub struct HeicConverter {
    bin: PathBuf,
    permits: Semaphore,
}

impl HeicConverter {
    pub fn new(bin: impl Into<PathBuf>) -> Self {
        Self {
            bin: bin.into(),
            permits: Semaphore::new(MAX_CONCURRENT_CONVERSIONS),
        }
    }

    /// Reads `HEIF_CONVERT_BIN` (default `heif-convert`, resolved on `PATH`).
    pub fn from_env() -> Self {
        let bin = std::env::var("HEIF_CONVERT_BIN")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "heif-convert".to_string());
        Self::new(bin)
    }

    /// Decode the primary image of `heif` and re-encode it as JPEG.
    pub async fn to_jpeg(&self, heif: &[u8]) -> Result<Vec<u8>, ConvertError> {
        if !is_heif(heif) {
            return Err(ConvertError::NotHeif);
        }

        let _permit = self
            .permits
            .acquire()
            .await
            .map_err(|e| ConvertError::Internal(e.to_string()))?;

        let dir = tempfile::tempdir()
            .map_err(|e| ConvertError::Internal(format!("creating temp dir: {e}")))?;
        let input = dir.path().join("input.heic");
        tokio::fs::write(&input, heif)
            .await
            .map_err(|e| ConvertError::Internal(format!("writing input: {e}")))?;

        let child = Command::new(&self.bin)
            .args(["-q", JPEG_QUALITY, "input.heic", "output.jpg"])
            .current_dir(dir.path())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => ConvertError::Unavailable,
                _ => ConvertError::Internal(format!("spawning {}: {e}", self.bin.display())),
            })?;

        let output = tokio::time::timeout(CONVERT_TIMEOUT, child.wait_with_output())
            .await
            .map_err(|_| ConvertError::Internal("HEIC conversion timed out".into()))?
            .map_err(|e| ConvertError::Internal(format!("waiting for converter: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(ConvertError::Decode(stderr.trim().to_string()));
        }

        let Some(path) = find_output(dir.path()).await else {
            return Err(ConvertError::Decode("converter wrote no image".into()));
        };
        tokio::fs::read(&path)
            .await
            .map_err(|e| ConvertError::Internal(format!("reading output: {e}")))
    }
}

/// Whether `bytes` starts with an ISOBMFF `ftyp` box carrying a HEIF brand.
fn is_heif(bytes: &[u8]) -> bool {
    const BRANDS: &[&[u8; 4]] = &[
        b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"mif1", b"msf1",
    ];
    if bytes.len() < 12 || &bytes[4..8] != b"ftyp" {
        return false;
    }
    let box_len = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    let end = box_len.clamp(12, bytes.len());
    // Major brand at 8..12, then a minor version, then the compatible brands.
    std::iter::once(&bytes[8..12])
        .chain(bytes.get(16..end).unwrap_or_default().chunks_exact(4))
        .any(|brand| BRANDS.iter().any(|b| b.as_slice() == brand))
}

/// The JPEG `heif-convert` produced for the primary image.
///
/// Recent libheif writes exactly the requested `output.jpg`. Older releases
/// (Debian bookworm ships 1.15) number the outputs `output-1.jpg`, … when the
/// file holds several top-level images, and also write depth/auxiliary images
/// alongside; those are skipped.
async fn find_output(dir: &Path) -> Option<PathBuf> {
    let exact = dir.join("output.jpg");
    if tokio::fs::try_exists(&exact).await.unwrap_or(false) {
        return Some(exact);
    }
    let mut entries = tokio::fs::read_dir(dir).await.ok()?;
    let mut numbered = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name();
        let Some(n) = name
            .to_str()
            .and_then(|n| n.strip_prefix("output-"))
            .and_then(|n| n.strip_suffix(".jpg"))
            .and_then(|n| n.parse::<u32>().ok())
        else {
            continue;
        };
        numbered.push((n, entry.path()));
    }
    numbered.into_iter().min_by_key(|(n, _)| *n).map(|(_, p)| p)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &[u8] = include_bytes!("../tests/fixtures/exif-gps.heic");

    #[test]
    fn recognizes_heif_brands() {
        assert!(is_heif(FIXTURE));
        // A minimal `ftyp` with an unrelated major brand but `mif1` compatible.
        let mut mp4ish = Vec::new();
        mp4ish.extend_from_slice(&20u32.to_be_bytes());
        mp4ish.extend_from_slice(b"ftypavif\0\0\0\0mif1");
        assert!(is_heif(&mp4ish));
    }

    #[test]
    fn rejects_non_heif() {
        assert!(!is_heif(b""));
        assert!(!is_heif(&[
            0xff, 0xd8, 0xff, 0xe0, 0, 0x10, b'J', b'F', b'I', b'F', 0, 1
        ]));
        let mut mp4 = Vec::new();
        mp4.extend_from_slice(&20u32.to_be_bytes());
        mp4.extend_from_slice(b"ftypisom\0\0\0\0mp41");
        assert!(!is_heif(&mp4));
    }

    #[tokio::test]
    async fn picks_lowest_numbered_output_when_unsuffixed_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        for name in [
            "output-2.jpg",
            "output-1.jpg",
            "output-depth.jpg",
            "input.heic",
        ] {
            std::fs::write(dir.path().join(name), b"x").unwrap();
        }
        let found = find_output(dir.path()).await.unwrap();
        assert_eq!(found.file_name().unwrap(), "output-1.jpg");
    }

    #[tokio::test]
    async fn prefers_exact_output() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["output.jpg", "output-1.jpg"] {
            std::fs::write(dir.path().join(name), b"x").unwrap();
        }
        let found = find_output(dir.path()).await.unwrap();
        assert_eq!(found.file_name().unwrap(), "output.jpg");
    }

    #[tokio::test]
    async fn missing_binary_is_unavailable() {
        let converter = HeicConverter::new("/nonexistent/heif-convert");
        assert!(matches!(
            converter.to_jpeg(FIXTURE).await,
            Err(ConvertError::Unavailable)
        ));
    }

    #[tokio::test]
    async fn non_heif_input_is_rejected_before_spawning() {
        let converter = HeicConverter::new("/nonexistent/heif-convert");
        assert!(matches!(
            converter.to_jpeg(b"not an image").await,
            Err(ConvertError::NotHeif)
        ));
    }

    /// Exercises the real converter when libheif is installed (`brew install
    /// libheif`); skipped otherwise so CI doesn't need it.
    #[tokio::test]
    async fn converts_fixture_when_libheif_is_installed() {
        let converter = HeicConverter::from_env();
        match converter.to_jpeg(FIXTURE).await {
            Ok(jpeg) => assert_eq!(&jpeg[..3], &[0xff, 0xd8, 0xff], "not a JPEG"),
            Err(ConvertError::Unavailable) => {
                eprintln!("skipping: heif-convert not installed");
            }
            Err(e) => panic!("conversion failed: {e}"),
        }
    }
}
