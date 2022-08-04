//SPDX-License-Identifier: Unlicense

pragma solidity >=0.8.0;
import "contracts/TokemakCompounder.sol";

contract TokemakCompounderMock is TokemakCompounder {
    
    /**
    * Simulates a succesful claim for 5 TOKE. We will send TOKE to the contract before calling compound to mock.
    */
    function claimTokeRewards (
        ITokemakReward.Recipient calldata recipient,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) override internal returns (uint) {
        return TOKE_TOKEN.balanceOf(address(this));
    }
}