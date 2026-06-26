#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
NET=testnet
SRC=crowdfund
TOKEN=$(stellar contract id asset --asset native --network $NET)

echo "Building contracts..."
( cd contracts/campaign && stellar contract build >/dev/null )
( cd contracts/reputation && stellar contract build >/dev/null )
( cd contracts/factory && stellar contract build >/dev/null )

echo "Uploading campaign wasm..."
CAMPAIGN_HASH=$(stellar contract upload --wasm contracts/campaign/target/wasm32v1-none/release/campaign.wasm --source $SRC --network $NET)

echo "Deploying reputation..."
sleep 4
REP_ID=$(stellar contract deploy --wasm contracts/reputation/target/wasm32v1-none/release/reputation.wasm --source $SRC --network $NET)

echo "Deploying factory..."
sleep 4
FACTORY_ID=$(stellar contract deploy --wasm contracts/factory/target/wasm32v1-none/release/factory.wasm --source $SRC --network $NET)

sleep 4
echo "Init factory..."
stellar contract invoke --id $FACTORY_ID --source $SRC --network $NET -- init --campaign_wasm_hash $CAMPAIGN_HASH --token $TOKEN --reputation $REP_ID >/dev/null

sleep 4
echo "Init reputation..."
stellar contract invoke --id $REP_ID --source $SRC --network $NET -- init --factory $FACTORY_ID >/dev/null

echo "RESULT TOKEN=$TOKEN"
echo "RESULT CAMPAIGN_HASH=$CAMPAIGN_HASH"
echo "RESULT REPUTATION_ID=$REP_ID"
echo "RESULT FACTORY_ID=$FACTORY_ID"
