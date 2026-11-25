//! An HTTP client for fetching from user-chosen hosts.
//!
//! A blob request names any DID, and the DID document names any PDS URL, so
//! without a guard `/media/blob` would fetch from internal addresses on an
//! anonymous caller's behalf (SSRF). The client here only connects to public
//! IP addresses: every hostname, including redirect targets, goes through
//! [`PublicOnlyResolver`], and IP-literal URLs are checked by
//! [`check_url`] and the redirect policy, since they skip DNS.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::redirect;
use reqwest::Url;

/// Whole-request timeout, so a PDS that trickles bytes can't hold a handler.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REDIRECTS: usize = 5;

/// A client that refuses non-public addresses and plain HTTP.
pub fn public_only_client() -> reqwest::Client {
    reqwest::Client::builder()
        .https_only(true)
        .dns_resolver(Arc::new(PublicOnlyResolver))
        .redirect(redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                attempt.error("too many redirects")
            } else if let Err(e) = check_url(attempt.url()) {
                attempt.error(e)
            } else {
                attempt.follow()
            }
        }))
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .expect("static reqwest client config")
}

/// Reject a URL whose host is a non-public IP literal. Hostnames pass here;
/// [`PublicOnlyResolver`] checks what they resolve to.
pub fn check_url(url: &Url) -> Result<(), String> {
    let ip = match url.host() {
        Some(url::Host::Ipv4(ip)) => IpAddr::V4(ip),
        Some(url::Host::Ipv6(ip)) => IpAddr::V6(ip),
        Some(url::Host::Domain(_)) => return Ok(()),
        None => return Err(format!("no host in {url}")),
    };
    if is_public(ip) {
        Ok(())
    } else {
        Err(format!("non-public address {ip}"))
    }
}

/// System DNS, with every non-public address dropped. A name with no public
/// address fails to resolve.
struct PublicOnlyResolver;

impl Resolve for PublicOnlyResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let host = name.as_str().to_owned();
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0))
                .await?
                .filter(|addr| is_public(addr.ip()))
                .collect();
            if addrs.is_empty() {
                return Err(format!("{host} has no public address").into());
            }
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

/// Whether `ip` is a globally routable unicast address. (`IpAddr::is_global`
/// is still unstable.)
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_v4(v4);
            }
            is_public_v6(v6)
        }
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || a == 0
        // Shared address space (carrier-grade NAT), 100.64.0.0/10
        || (a == 100 && (b & 0xc0) == 64)
        // IETF protocol assignments, 192.0.0.0/24
        || (a == 192 && b == 0 && c == 0)
        // Benchmarking, 198.18.0.0/15
        || (a == 198 && (b & 0xfe) == 18)
        // Reserved, 240.0.0.0/4
        || a >= 240)
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    let seg = ip.segments();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        // Unique local, fc00::/7
        || (seg[0] & 0xfe00) == 0xfc00
        // Link-local, fe80::/10
        || (seg[0] & 0xffc0) == 0xfe80
        // Site-local (deprecated), fec0::/10
        || (seg[0] & 0xffc0) == 0xfec0
        // Documentation, 2001:db8::/32
        || (seg[0] == 0x2001 && seg[1] == 0x0db8)
        // NAT64, 64:ff9b::/96 — can reach IPv4 space behind a translator
        || (seg[0] == 0x64 && seg[1] == 0xff9b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_addresses_pass() {
        for ip in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(is_public(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn internal_addresses_are_rejected() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "255.255.255.255",
            "::1",
            "::",
            "fd00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
            "::ffff:169.254.169.254",
            "64:ff9b::a9fe:a9fe",
        ] {
            assert!(!is_public(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn check_url_rejects_internal_ip_literals_only() {
        let ok = |u: &str| check_url(&Url::parse(u).unwrap()).is_ok();
        assert!(ok("https://pds.example.com"));
        assert!(ok("https://8.8.8.8"));
        assert!(!ok("https://169.254.169.254/latest"));
        assert!(!ok("https://[::1]:8080"));
        assert!(!ok("https://10.0.0.5"));
    }

    #[tokio::test]
    async fn resolver_drops_loopback_hostnames() {
        // `localhost` resolves only to loopback addresses.
        let name: Name = "localhost".parse().unwrap();
        let err = PublicOnlyResolver.resolve(name).await.err().unwrap();
        assert!(err.to_string().contains("no public address"), "{err}");
    }

    #[tokio::test]
    async fn client_refuses_plain_http() {
        let err = public_only_client()
            .get("http://example.com/")
            .send()
            .await
            .unwrap_err();
        assert!(err.is_builder(), "{err:?}");
    }
}
