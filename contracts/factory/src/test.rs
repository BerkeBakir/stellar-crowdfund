#![cfg(test)]
use super::{Factory, FactoryClient};
use soroban_sdk::{
    contractimport,
    testutils::{Address as _, Ledger as _},
    Address, Env,
};

// campaign::WASM (via the `campaign` crate dev-dependency) cannot be used here:
// the campaign crate is `crate-type = ["cdylib", "rlib"]`, and pulling it in as a
// Cargo dependency forces cargo to also link its cdylib on this Windows-gnu
// toolchain, which fails with `export ordinal too large` (too many soroban-sdk
// generated exports for a Windows DLL). Importing the prebuilt wasm bytes
// directly avoids building campaign as a Rust dependency altogether.
mod campaign_wasm {
    use super::contractimport;
    contractimport!(file = "../campaign/target/wasm32v1-none/release/campaign.wasm");
}

fn setup() -> (Env, FactoryClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1000);

    // Upload the campaign wasm so the factory can deploy instances of it.
    let wasm_hash = env.deployer().upload_contract_wasm(campaign_wasm::WASM);
    let token = Address::generate(&env);
    let reputation = Address::generate(&env);

    let factory_id = env.register(Factory, ());
    let client = FactoryClient::new(&env, &factory_id);
    client.init(&wasm_hash, &token, &reputation);
    let creator = Address::generate(&env);
    (env, client, creator)
}

#[test]
fn creates_and_registers_campaign() {
    let (env, client, creator) = setup();
    let addr = client.create_campaign(&creator, &1000i128, &2000u64);
    let list = client.list_campaigns();
    assert_eq!(list.len(), 1);
    assert_eq!(list.get(0).unwrap(), addr.clone());
    assert!(client.is_campaign(&addr));
    let random = Address::generate(&env);
    assert!(!client.is_campaign(&random));
}

#[test]
#[should_panic(expected = "goal must be positive")]
fn rejects_zero_goal() {
    let (_env, client, creator) = setup();
    client.create_campaign(&creator, &0i128, &2000u64);
}
