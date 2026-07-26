mod abi;
mod pb {
    pub mod investmade {
        pub mod uniswap {
            pub mod v4 {
                include!(concat!(env!("OUT_DIR"), "/investmade.uniswap.v4.rs"));
            }
        }
    }
}

use abi::pool_manager::events;
use pb::investmade::uniswap::v4::{Events, Initialize, Swap};
use substreams::errors::Error;
use substreams::Hex;
use substreams_ethereum::pb::eth::v2 as eth;
use substreams_ethereum::Event;

const POOL_MANAGER: [u8; 20] = [
    0x83, 0x66, 0xa3, 0x9c, 0xc6, 0x70, 0xb4, 0x00, 0x1a, 0x11,
    0x21, 0xb8, 0xf6, 0xa4, 0x43, 0xa6, 0x43, 0xe4, 0x09, 0x51,
];

fn hex0x(bytes: &[u8]) -> String {
    format!("0x{}", Hex::encode(bytes))
}

fn i32_value(value: impl ToString) -> i32 {
    value.to_string().parse().unwrap_or_default()
}

#[substreams::handlers::map]
fn map_events(block: eth::Block) -> Result<Events, Error> {
    let timestamp = block
        .header
        .as_ref()
        .and_then(|header| header.timestamp.as_ref())
        .map(|timestamp| timestamp.seconds as u64)
        .unwrap_or_default();
    let mut initializes = Vec::new();
    let mut swaps = Vec::new();

    for transaction in block.transactions() {
        let transaction_hash = hex0x(&transaction.hash);

        for (log, _) in transaction.logs_with_calls() {
            if log.address.as_slice() != POOL_MANAGER {
                continue;
            }

            if let Some(event) = events::Initialize::match_and_decode(log) {
                initializes.push(Initialize {
                    block_number: block.number,
                    timestamp,
                    transaction_hash: transaction_hash.clone(),
                    log_index: log.index,
                    pool_id: hex0x(&event.id),
                    currency0: hex0x(&event.currency0),
                    currency1: hex0x(&event.currency1),
                    fee: event.fee.to_u64() as u32,
                    tick_spacing: i32_value(event.tick_spacing),
                    hooks: hex0x(&event.hooks),
                    sqrt_price_x96: event.sqrt_price_x96.to_string(),
                    tick: i32_value(event.tick),
                });
            } else if let Some(event) = events::Swap::match_and_decode(log) {
                swaps.push(Swap {
                    block_number: block.number,
                    timestamp,
                    transaction_hash: transaction_hash.clone(),
                    log_index: log.index,
                    pool_id: hex0x(&event.id),
                    sender: hex0x(&event.sender),
                    amount0: event.amount0.to_string(),
                    amount1: event.amount1.to_string(),
                    sqrt_price_x96: event.sqrt_price_x96.to_string(),
                    liquidity: event.liquidity.to_string(),
                    tick: i32_value(event.tick),
                    fee: event.fee.to_u64() as u32,
                });
            }
        }
    }

    Ok(Events { initializes, swaps })
}
