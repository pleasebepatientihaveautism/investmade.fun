# Investmade Robinhood Uniswap v4

Streams decoded Uniswap v4 pool initialization and swap events from Robinhood Chain.

## Overview

This package indexes the official Uniswap v4 PoolManager at
`0x8366a39cc670b4001a1121b8f6a443a643e40951` from block `9070`. It emits pool
token metadata from `Initialize` and historical price/liquidity points from
`Swap` for Investmade's AI market ranking and charts.

## Modules

| Module | Kind | Output | Description |
| --- | --- | --- | --- |
| `map_events` | map | `investmade.uniswap.v4.Events` | Decoded `Initialize` and `Swap` events |

## Prerequisites

- Substreams CLI
- A The Graph Market API key

## Quick Start

```bash
substreams run ./substreams.yaml map_events \
  --network robinhood \
  --start-block 9070 \
  --stop-block +1000 \
  --output jsonl
```
