#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
NET=testnet; SRC=crowdfund
G=$(stellar keys address $SRC)
FACTORY=${FACTORY_ID:?set FACTORY_ID}
NOW=$(date +%s)
retry(){ for i in 1 2 3 4 5; do out=$("$@" 2>/dev/null) && [[ -n "$out" ]] && { echo "$out"; return 0; }; sleep 8; done; return 1; }

A=$(retry stellar contract invoke --id $FACTORY --source $SRC --network $NET -- create_campaign --creator $G --goal 50000000 --deadline $((NOW+600)) | tr -d '"')
echo "Campaign A=$A"
retry stellar contract invoke --id $A --source $SRC --network $NET -- contribute --from $G --amount 50000000 >/dev/null && echo "A funded to goal"

B=$(retry stellar contract invoke --id $FACTORY --source $SRC --network $NET -- create_campaign --creator $G --goal 200000000 --deadline $((NOW+86400)) | tr -d '"')
echo "Campaign B=$B"
retry stellar contract invoke --id $B --source $SRC --network $NET -- contribute --from $G --amount 20000000 >/dev/null && echo "B partially funded"
echo "SEED_A=$A"
echo "SEED_B=$B"
