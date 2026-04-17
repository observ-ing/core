use atrium_identity::handle::DnsTxtResolver;
use hickory_resolver::proto::rr::RData;
use hickory_resolver::TokioResolver;

pub struct HickoryDnsTxtResolver {
    resolver: TokioResolver,
}

impl Default for HickoryDnsTxtResolver {
    fn default() -> Self {
        Self {
            resolver: TokioResolver::builder_tokio()
                .expect("failed to create DNS resolver")
                .build()
                .expect("failed to build DNS resolver"),
        }
    }
}

impl DnsTxtResolver for HickoryDnsTxtResolver {
    async fn resolve(
        &self,
        query: &str,
    ) -> core::result::Result<Vec<String>, Box<dyn std::error::Error + Send + Sync + 'static>> {
        Ok(self
            .resolver
            .txt_lookup(query)
            .await?
            .answers()
            .iter()
            .filter_map(|record| match &record.data {
                RData::TXT(txt) => Some(txt.to_string()),
                _ => None,
            })
            .collect())
    }
}
