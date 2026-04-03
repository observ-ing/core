use std::fmt;

pub type Result<T> = std::result::Result<T, QuickSliceError>;

#[derive(Debug)]
pub enum QuickSliceError {
    Http(reqwest::Error),
    GraphQL(Vec<GraphQLError>),
    Deserialize(serde_json::Error),
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct GraphQLError {
    pub message: String,
    pub path: Option<Vec<serde_json::Value>>,
}

impl fmt::Display for QuickSliceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Http(e) => write!(f, "HTTP error: {e}"),
            Self::GraphQL(errors) => {
                let msgs: Vec<_> = errors.iter().map(|e| e.message.as_str()).collect();
                write!(f, "GraphQL errors: {}", msgs.join("; "))
            }
            Self::Deserialize(e) => write!(f, "Deserialization error: {e}"),
        }
    }
}

impl std::error::Error for QuickSliceError {}

impl From<reqwest::Error> for QuickSliceError {
    fn from(e: reqwest::Error) -> Self {
        Self::Http(e)
    }
}

impl From<serde_json::Error> for QuickSliceError {
    fn from(e: serde_json::Error) -> Self {
        Self::Deserialize(e)
    }
}
