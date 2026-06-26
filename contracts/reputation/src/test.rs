#![cfg(test)]
use super::{Reputation, ReputationClient};
use soroban_sdk::{testutils::Address as _, Address, Env};

// Minimal mock factory exposing is_campaign.
mod mock_factory_yes {
    use soroban_sdk::{contract, contractimpl, Address, Env};

    #[contract]
    pub struct MockFactory;
    #[contractimpl]
    impl MockFactory {
        pub fn is_campaign(_env: Env, _addr: Address) -> bool {
            true
        }
    }
}
use mock_factory_yes::MockFactory;

mod mock_factory_no {
    use soroban_sdk::{contract, contractimpl, Address, Env};

    #[contract]
    pub struct MockFactoryNo;
    #[contractimpl]
    impl MockFactoryNo {
        pub fn is_campaign(_env: Env, _addr: Address) -> bool {
            false
        }
    }
}
use mock_factory_no::MockFactoryNo;

fn setup(factory_yes: bool) -> (Env, ReputationClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let factory = if factory_yes {
        env.register(MockFactory, ())
    } else {
        env.register(MockFactoryNo, ())
    };
    let rep_id = env.register(Reputation, ());
    let client = ReputationClient::new(&env, &rep_id);
    client.init(&factory);
    (env, client, factory)
}

#[test]
fn records_and_reads_score() {
    let (env, client, _f) = setup(true);
    let campaign = Address::generate(&env);
    let creator = Address::generate(&env);
    client.record_success(&campaign, &creator);
    client.record_success(&campaign, &creator);
    assert_eq!(client.get_score(&creator), 2);
}

#[test]
fn unknown_creator_is_zero() {
    let (env, client, _f) = setup(true);
    let who = Address::generate(&env);
    assert_eq!(client.get_score(&who), 0);
}

#[test]
#[should_panic(expected = "caller is not a registered campaign")]
fn rejects_unregistered_campaign() {
    let (env, client, _f) = setup(false);
    let campaign = Address::generate(&env);
    let creator = Address::generate(&env);
    client.record_success(&campaign, &creator);
}
