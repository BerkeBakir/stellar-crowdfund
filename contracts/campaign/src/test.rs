#![cfg(test)]
extern crate std;
use super::{Campaign, CampaignClient};
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Events as _, Ledger},
    token, Address, Env, IntoVal,
};

// Mock reputation that records calls.
#[contract]
pub struct MockRep;
#[contractimpl]
impl MockRep {
    pub fn record_success(env: Env, _campaign: Address, creator: Address) {
        env.events().publish((symbol_short!("rec"),), creator);
    }
}

fn create_token<'a>(env: &Env, admin: &Address) -> (Address, token::StellarAssetClient<'a>) {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let id = sac.address();
    (id.clone(), token::StellarAssetClient::new(env, &id))
}

fn setup() -> (
    Env,
    CampaignClient<'static>,
    Address,
    Address,
    token::StellarAssetClient<'static>,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1000);

    let admin = Address::generate(&env);
    let (token_id, token_admin) = create_token(&env, &admin);
    let reputation = env.register(MockRep, ());
    let factory = Address::generate(&env);
    let creator = Address::generate(&env);

    let campaign_id = env.register(Campaign, ());
    let client = CampaignClient::new(&env, &campaign_id);
    // goal 1000 stroops, deadline 2000
    client.init(&creator, &1000i128, &2000u64, &token_id, &reputation, &factory);
    (env, client, creator, token_id, token_admin, reputation)
}

#[test]
fn contribute_accumulates_and_reaches_goal() {
    let (env, client, _creator, token_id, token_admin, _rep) = setup();
    let alice = Address::generate(&env);
    token_admin.mint(&alice, &2000);
    let token_client = token::TokenClient::new(&env, &token_id);

    client.contribute(&alice, &600);
    client.contribute(&alice, &500); // now 1100 >= 1000

    assert_eq!(client.contribution_of(&alice), 1100);
    let (_c, goal, _d, total, _status) = client.summary();
    assert_eq!(goal, 1000);
    assert_eq!(total, 1100);
    // funds moved into the campaign: alice minted 2000, contributed 1100
    assert_eq!(token_client.balance(&client.address), 1100);
    assert_eq!(token_client.balance(&alice), 900);
}

#[test]
fn claim_after_success_moves_funds_and_calls_reputation() {
    let (env, client, creator, token_id, token_admin, rep) = setup();
    let alice = Address::generate(&env);
    token_admin.mint(&alice, &2000);
    client.contribute(&alice, &1000); // exactly goal
    let token_client = token::TokenClient::new(&env, &token_id);

    // No reputation event should have been published before claim.
    let before_has_rec = env
        .events()
        .all()
        .iter()
        .any(|(addr, _topics, _data)| addr == rep);
    assert!(!before_has_rec);

    env.ledger().set_timestamp(3000); // past deadline 2000
    client.claim();

    // Capture events emitted by the `claim()` invocation before any further
    // top-level contract calls (like `summary()`) reset the event buffer.
    let rec_topic: soroban_sdk::Vec<soroban_sdk::Val> = (symbol_short!("rec"),).into_val(&env);
    let events_after_claim = env.events().all();

    assert_eq!(token_client.balance(&creator), 1000);
    assert_eq!(token_client.balance(&client.address), 0);
    let (_c, _g, _d, _t, status) = client.summary();
    assert_eq!(status, 1); // Claimed

    // Verify the cross-contract call to Reputation::record_success actually
    // fired: MockRep publishes (symbol_short!("rec"),) -> creator.
    let found_rep_event = events_after_claim.iter().any(|(addr, topics, data)| {
        if addr != rep || topics != rec_topic {
            return false;
        }
        let decoded_creator: Address = data.into_val(&env);
        decoded_creator == creator
    });
    assert!(
        found_rep_event,
        "expected MockRep to publish a 'rec' event with the creator address after claim"
    );
}

#[test]
fn refund_when_goal_missed() {
    let (env, client, _creator, token_id, token_admin, _rep) = setup();
    let bob = Address::generate(&env);
    token_admin.mint(&bob, &2000);
    client.contribute(&bob, &400); // below goal 1000
    let token_client = token::TokenClient::new(&env, &token_id);

    env.ledger().set_timestamp(3000); // past deadline
    client.refund(&bob);

    assert_eq!(token_client.balance(&bob), 2000); // got the 400 back
    assert_eq!(client.contribution_of(&bob), 0);
}

#[test]
#[should_panic(expected = "campaign is not active")]
fn cannot_contribute_after_deadline() {
    let (env, client, _creator, _t, token_admin, _rep) = setup();
    let alice = Address::generate(&env);
    token_admin.mint(&alice, &1000);
    env.ledger().set_timestamp(3000);
    client.contribute(&alice, &100);
}

#[test]
#[should_panic(expected = "goal not reached")]
fn cannot_claim_when_goal_missed() {
    let (env, client, _creator, _t, token_admin, _rep) = setup();
    let alice = Address::generate(&env);
    token_admin.mint(&alice, &1000);
    client.contribute(&alice, &100);
    env.ledger().set_timestamp(3000);
    client.claim();
}
