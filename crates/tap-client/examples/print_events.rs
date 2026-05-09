//! Connect to a local Tap, print the first N events, ack each, then exit.
//!
//! Usage: `cargo run -p tap-client --example print_events -- [--count 10] [--url ws://...]`

use std::env;
use std::time::Duration;
use tap_client::{TapConfig, TapEvent, TapSubscription};
use tokio::sync::mpsc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let mut url = "ws://localhost:2480/channel".to_string();
    let mut count: usize = 10;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--url" => {
                url = args[i + 1].clone();
                i += 2;
            }
            "--count" => {
                count = args[i + 1].parse()?;
                i += 2;
            }
            other => return Err(format!("unknown arg: {}", other).into()),
        }
    }

    let (event_tx, mut event_rx) = mpsc::channel(64);
    let (mut sub, ack) = TapSubscription::new(
        TapConfig {
            url,
            admin_password: env::var("TAP_ADMIN_PASSWORD").ok(),
        },
        event_tx,
    );

    let sub_handle = tokio::spawn(async move { sub.run().await });

    let mut received = 0usize;
    let timeout = tokio::time::sleep(Duration::from_secs(30));
    tokio::pin!(timeout);

    loop {
        tokio::select! {
            evt = event_rx.recv() => {
                let Some(evt) = evt else { break };
                match &evt {
                    TapEvent::Connected => println!("[connected]"),
                    TapEvent::Disconnected => println!("[disconnected]"),
                    TapEvent::Error(e) => println!("[error] {}", e),
                    TapEvent::Identity(i) => {
                        println!("identity id={} {} ({}, status={})", i.id, i.did, i.handle, i.status);
                    }
                    TapEvent::Record(r) => {
                        println!(
                            "record  id={} live={} {} {} {} cid={}",
                            r.id, r.live, r.action, r.collection, r.rkey,
                            r.cid.as_deref().unwrap_or("-")
                        );
                    }
                }
                if let Some(id) = evt.id() {
                    ack.ack(id).await?;
                    received += 1;
                    if received >= count {
                        println!("[done] received {} events; closing", received);
                        break;
                    }
                }
            }
            _ = &mut timeout => {
                println!("[timeout] received {}/{} events in 30s", received, count);
                break;
            }
        }
    }

    drop(ack);
    let _ = sub_handle.await;
    Ok(())
}
