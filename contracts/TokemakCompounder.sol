//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

import "contracts/interfaces/ITokemakReward.sol";
import "contracts/interfaces/ITokemakRewardHash.sol";
import "contracts/interfaces/ISushiRouter.sol";
import "contracts/interfaces/ITokeFarm.sol";

contract TokemakCompounder {
    address public owner;
    uint256 public depositedLP = 0;

    address constant TOKE_TOKEN_ADDRESS = 0x2e9d63788249371f1DFC918a52f8d799F4a38C94;
    IERC20 constant TOKE_TOKEN = IERC20(TOKE_TOKEN_ADDRESS);

    ITokemakRewardHash constant TOKEN_REWARD_HASH_CONTRACT = ITokemakRewardHash(0x5ec3EC6A8aC774c7d53665ebc5DDf89145d02fB6);
    ITokemakReward constant TOKEN_REWARD_CONTRACT = ITokemakReward(0x79dD22579112d8a5F7347c5ED7E609e60da713C5);

    address constant SUSHI_ROUTER_ADDRESS = 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F;
    ISushiRouter constant SUSHI_ROUTER = ISushiRouter(payable(SUSHI_ROUTER_ADDRESS));

    address constant TOKE_ETH_SUSHI_LP_TOKEN_ADDRESS = 0xd4e7a6e2D03e4e48DfC27dd3f46DF1c176647E38;
    IERC20 constant TOKE_ETH_SUSHI_LP_TOKEN = IERC20(TOKE_ETH_SUSHI_LP_TOKEN_ADDRESS);
    IUniswapV2Pair constant TOKE_ETH_SUSHI_POOL = IUniswapV2Pair(TOKE_ETH_SUSHI_LP_TOKEN_ADDRESS);

    address constant TOKEMAK_FARM_ADDRESS = 0x8858A739eA1dd3D80FE577EF4e0D03E88561FaA3;
    ITokeFarm constant TOKEMAK_FARM = ITokeFarm(TOKEMAK_FARM_ADDRESS);

    uint256 constant SWAP_EXPIRE_TIME = 9999999999;

    constructor() {
        owner = msg.sender;
    }

    function deposit(uint256 amount) public {
        // Ensure that the user has approved the SLP to this contract before depositing
        require(
            TOKE_ETH_SUSHI_LP_TOKEN.allowance(owner, address(this)) >= amount,
            "Must approve TOKE-ETH SLP to compounding contract"
        );
        TOKE_ETH_SUSHI_LP_TOKEN.transferFrom(owner, address(this), amount);

        // Approve SLP to Farm contract
        handleAllowance(TOKE_ETH_SUSHI_LP_TOKEN_ADDRESS, TOKEMAK_FARM_ADDRESS);

        TOKEMAK_FARM.deposit(amount);
        depositedLP += amount;
    }

    function compound(
        ITokemakReward.Recipient calldata recipient,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public {
        require(recipient.wallet == address(this), "Can only compound our position");
        require(recipient.amount > 0, "Nothing to claim");
        
        uint tokeBalance = claimTokeRewards(recipient, v, r, s);
        uint256 swapAmount = tokeBalance / 2;
        swapTokeForETH(swapAmount);

        uint256 amountTokenDesired = tokeBalance - swapAmount;
        addLP(amountTokenDesired);

        stakeLP();
    }

    function initiateWithdrawal(uint256 amount) public {
        TOKEMAK_FARM.requestWithdrawal(amount);
    }

    function completeWithdrawal(uint256 amount) public {
        (uint256 minCycle, uint256 maxWithdrawAmount) = TOKEMAK_FARM.requestedWithdrawals(address(this));
        uint256 currentCycle = TOKEN_REWARD_HASH_CONTRACT.latestCycleIndex();

        require(maxWithdrawAmount >= amount, "Withdrawing more SLP than ready");
        require(currentCycle >= minCycle, "Must wait more cycles before withdrawing");

        TOKEMAK_FARM.withdraw(amount);
        TOKE_ETH_SUSHI_LP_TOKEN.transfer(owner, amount);
        depositedLP-= amount;
    }

    // Contract needs to have a receive function to get ETH from a swap
    receive() external payable { 
        
    }

    // INTERNAL FUNCTIONS

    function claimTokeRewards(
        ITokemakReward.Recipient calldata recipient,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal virtual returns (uint) {
        TOKEN_REWARD_CONTRACT.claim(recipient, v, r, s);
        uint tokeBalance = TOKE_TOKEN.balanceOf(address(this));
        require(tokeBalance > 0, "No toke to compound");
        return tokeBalance;
    }

    function swapTokeForETH(uint swapAmount) internal {
        // Approve toke to router before swap
        handleAllowance(TOKE_TOKEN_ADDRESS, SUSHI_ROUTER_ADDRESS);

        address[] memory route = new address[](2); 
        route[0] = TOKE_TOKEN_ADDRESS;
        route[1] = SUSHI_ROUTER.WETH();

        uint[] memory minOut = SUSHI_ROUTER.getAmountsOut(swapAmount, route);
        require(minOut.length == 2, "getAmountsOut call failed");

        SUSHI_ROUTER.swapExactTokensForETH(
            swapAmount,
            // TODO: Use quote() to create a resonable minOut value
            minOut[1] / 5 * 4, // 20% slippage
            route,
            address(this),
            // TODO: Use a constant deadline from current time
            SWAP_EXPIRE_TIME
        );
    }

    function addLP(uint amountTokenDesired) internal {
        // Approve toke to LP Pool before adding liquidity
        handleAllowance(TOKE_TOKEN_ADDRESS, TOKE_ETH_SUSHI_LP_TOKEN_ADDRESS);

        // Deposit atleast 80% of ETH and TOKE in the contract
        SUSHI_ROUTER.addLiquidityETH{value:address(this).balance}(
            TOKE_TOKEN_ADDRESS,
            amountTokenDesired, //amountTokenDesired
            amountTokenDesired * 4 / 5, //amountTokenMin
            address(this).balance * 4 / 5, //amountETHMin
            address(this), //to
            SWAP_EXPIRE_TIME
        );
    }

    function stakeLP() internal {
        uint256 LP_TOKEN_AMOUNT = TOKE_ETH_SUSHI_LP_TOKEN.balanceOf(address(this));
        // Approve toke to LP Pool before adding liquidity
        handleAllowance(TOKE_ETH_SUSHI_LP_TOKEN_ADDRESS, TOKEMAK_FARM_ADDRESS);
        TOKEMAK_FARM.deposit(LP_TOKEN_AMOUNT);
        depositedLP += LP_TOKEN_AMOUNT;
    }

    function handleAllowance(address tokenAddress, address approveTo) internal {
        IERC20 token = IERC20(tokenAddress);
        uint256 MAX_INT = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
        if (token.allowance(address(this), approveTo) != MAX_INT) {
            token.approve(approveTo, MAX_INT);
        }
    }
}
