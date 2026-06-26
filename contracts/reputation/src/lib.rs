#![no_std]
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, Address, Env,
};

#[contractclient(name = "FactoryClient")]
pub trait FactoryInterface {
    fn is_campaign(env: Env, addr: Address) -> bool;
}

#[contracttype]
pub enum DataKey {
    Factory,
    Score(Address),
}

#[contract]
pub struct Reputation;

#[contractimpl]
impl Reputation {
    pub fn init(env: Env, factory: Address) {
        if env.storage().instance().has(&DataKey::Factory) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Factory, &factory);
    }

    pub fn record_success(env: Env, campaign: Address, creator: Address) {
        // The calling campaign must authorize this sub-invocation.
        campaign.require_auth();

        let factory: Address = env.storage().instance().get(&DataKey::Factory).unwrap();
        let is_campaign = FactoryClient::new(&env, &factory).is_campaign(&campaign);
        if !is_campaign {
            panic!("caller is not a registered campaign");
        }

        let key = DataKey::Score(creator.clone());
        let score: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        let new_score = score + 1;
        env.storage().persistent().set(&key, &new_score);
        env.events()
            .publish((symbol_short!("rep_up"), creator), new_score);
    }

    pub fn get_score(env: Env, creator: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Score(creator))
            .unwrap_or(0)
    }
}

mod test;
