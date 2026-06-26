#![no_std]
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, token, Address, Env,
};

#[contractclient(name = "ReputationClient")]
pub trait ReputationInterface {
    fn record_success(env: Env, campaign: Address, creator: Address);
}

#[derive(Clone, Copy, PartialEq)]
#[contracttype]
pub enum Status {
    Active = 0,
    Claimed = 1,
    Refunding = 2,
}

#[contracttype]
pub enum DataKey {
    Creator,
    Goal,
    Deadline,
    Token,
    Reputation,
    Factory,
    Status,
    TotalRaised,
    Contribution(Address),
}

#[contract]
pub struct Campaign;

#[contractimpl]
impl Campaign {
    pub fn init(
        env: Env,
        creator: Address,
        goal: i128,
        deadline: u64,
        token: Address,
        reputation: Address,
        factory: Address,
    ) {
        if env.storage().instance().has(&DataKey::Creator) {
            panic!("already initialized");
        }
        if goal <= 0 {
            panic!("goal must be positive");
        }
        let s = env.storage().instance();
        s.set(&DataKey::Creator, &creator);
        s.set(&DataKey::Goal, &goal);
        s.set(&DataKey::Deadline, &deadline);
        s.set(&DataKey::Token, &token);
        s.set(&DataKey::Reputation, &reputation);
        s.set(&DataKey::Factory, &factory);
        s.set(&DataKey::Status, &Status::Active);
        s.set(&DataKey::TotalRaised, &0i128);
    }

    pub fn contribute(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let s = env.storage().instance();
        let status: Status = s.get(&DataKey::Status).unwrap();
        let deadline: u64 = s.get(&DataKey::Deadline).unwrap();
        if status != Status::Active || env.ledger().timestamp() > deadline {
            panic!("campaign is not active");
        }

        let token: Address = s.get(&DataKey::Token).unwrap();
        let this = env.current_contract_address();
        token::TokenClient::new(&env, &token).transfer(&from, &this, &amount);

        let ckey = DataKey::Contribution(from.clone());
        let prev: i128 = env.storage().persistent().get(&ckey).unwrap_or(0);
        env.storage().persistent().set(&ckey, &(prev + amount));

        let total: i128 = s.get(&DataKey::TotalRaised).unwrap();
        let new_total = total + amount;
        s.set(&DataKey::TotalRaised, &new_total);

        env.events().publish((symbol_short!("contrib"), from), amount);

        let goal: i128 = s.get(&DataKey::Goal).unwrap();
        if new_total >= goal {
            env.events().publish((symbol_short!("goal_met"),), new_total);
        }
    }

    pub fn claim(env: Env) {
        let s = env.storage().instance();
        let creator: Address = s.get(&DataKey::Creator).unwrap();
        creator.require_auth();

        let status: Status = s.get(&DataKey::Status).unwrap();
        let deadline: u64 = s.get(&DataKey::Deadline).unwrap();
        let goal: i128 = s.get(&DataKey::Goal).unwrap();
        let total: i128 = s.get(&DataKey::TotalRaised).unwrap();
        if status != Status::Active {
            panic!("campaign is not active");
        }
        if env.ledger().timestamp() <= deadline {
            panic!("deadline not reached");
        }
        if total < goal {
            panic!("goal not reached");
        }

        s.set(&DataKey::Status, &Status::Claimed);

        let token: Address = s.get(&DataKey::Token).unwrap();
        let this = env.current_contract_address();
        token::TokenClient::new(&env, &token).transfer(&this, &creator, &total);

        let reputation: Address = s.get(&DataKey::Reputation).unwrap();
        ReputationClient::new(&env, &reputation).record_success(&this, &creator);

        env.events().publish((symbol_short!("claimed"), creator), total);
    }

    pub fn refund(env: Env, caller: Address) {
        caller.require_auth();
        let s = env.storage().instance();
        let status: Status = s.get(&DataKey::Status).unwrap();
        let deadline: u64 = s.get(&DataKey::Deadline).unwrap();
        let goal: i128 = s.get(&DataKey::Goal).unwrap();
        let total: i128 = s.get(&DataKey::TotalRaised).unwrap();
        if env.ledger().timestamp() <= deadline {
            panic!("deadline not reached");
        }
        if total >= goal {
            panic!("goal was reached");
        }
        if status == Status::Claimed {
            panic!("already claimed");
        }
        s.set(&DataKey::Status, &Status::Refunding);

        let ckey = DataKey::Contribution(caller.clone());
        let amount: i128 = env.storage().persistent().get(&ckey).unwrap_or(0);
        if amount <= 0 {
            panic!("nothing to refund");
        }
        env.storage().persistent().set(&ckey, &0i128);

        let token: Address = s.get(&DataKey::Token).unwrap();
        let this = env.current_contract_address();
        token::TokenClient::new(&env, &token).transfer(&this, &caller, &amount);

        env.events().publish((symbol_short!("refunded"), caller), amount);
    }

    pub fn summary(env: Env) -> (Address, i128, u64, i128, u32) {
        let s = env.storage().instance();
        let creator: Address = s.get(&DataKey::Creator).unwrap();
        let goal: i128 = s.get(&DataKey::Goal).unwrap();
        let deadline: u64 = s.get(&DataKey::Deadline).unwrap();
        let total: i128 = s.get(&DataKey::TotalRaised).unwrap();
        let status: Status = s.get(&DataKey::Status).unwrap();
        (creator, goal, deadline, total, status as u32)
    }

    pub fn contribution_of(env: Env, who: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Contribution(who))
            .unwrap_or(0)
    }
}

mod test;
