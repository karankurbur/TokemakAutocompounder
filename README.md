This smart contract enables the following functionality:

- **Deposits**
  - The contract should only accept deposits from a single, pre-determined user (you).
  - The contract should only accept deposits of `TOKE-ETH` Uniswap V2 LP tokens.
  - The contract should always stake all its deposits in Tokemak's UNI LP token pool.
- **Auto-compounding**
  - The contract should auto-compound Tokemak's staking rewards (with a function call).
  - "Auto-compound" means claiming any outstanding rewards from Tokemak, converting them into more `TOKE-ETH` Uniswap V2 LP tokens, and staking them as well.
- **Withdrawals**
  - The contract should only accept withdrawals to a single, pre-determined user (you).
  - The contract should only process withdrawals in TOKE-ETH Uniswap V2 LP tokens.
