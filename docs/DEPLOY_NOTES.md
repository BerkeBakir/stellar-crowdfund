# Deploy Notes — Stellar Crowdfund (Testnet)

## Toolchain
- rustc/cargo 1.96.0 (default toolchain stable-x86_64-pc-windows-gnu)
- stellar-cli 27.0.0
- wasm target wasm32v1-none
- Contract unit tests: `cargo test --lib` (plain `cargo test` fails at mingw cdylib link)

## Identity
- Alias: `crowdfund` (network: Test SDF Network ; September 2015)
- Public address: GAIWPIHUUPTJDUOHUKTXZZLYZNPDHMO23J4QIWOJKITUYYK3WFBEHWQT (funded via Friendbot)

## Addresses
- Native SAC token: CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
- Campaign wasm hash: 8b06a0cf3140bbc9917c96a9e6252fc5ec9505d1b0ede82c1f274cd68d3c829f
- Reputation contract ID: CDCW4N245PCGTYZOOSNY2PJXZMGU4B6GVVNX4FWHC34QPSC27FV5ZPQR
- Factory contract ID: CB7XBGQMQCABLW6YAHPDKNLPXZSG7TVAR6EZGVL4PKAQC4DLDVSFFXRW
- Explorer (factory): https://stellar.expert/explorer/testnet/contract/CB7XBGQMQCABLW6YAHPDKNLPXZSG7TVAR6EZGVL4PKAQC4DLDVSFFXRW
- Smoke test: create_campaign deployed campaigns CAITTLUU2U5O64BEDXHSR6YUSZGX5LOUV46ZPL66VHISNFESJSZAI65W and CB2WMDRFI2TQJYPBW5JQRAR3YY5C2K4W5ZEWJLPJWQPIHPSTDGUN4Q6Z; list_campaigns + is_campaign verified on testnet (Factory->Campaign on-chain deploy works)
- Sample interaction tx hash: _(filled after Task 19)_
