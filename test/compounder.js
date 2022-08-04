const { expect, assert } = require("chai");
const exp = require("constants");
const hre = require("hardhat");
const axios = require("axios");
const ipfsClaim = require("./claim.json");

describe("Compounder", function () {
  const impersonatedAddressIPFSClaim = "0x84d2e9482f14534cfc3c9b1ad01c614863d53acc";
  const WETHAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const mainnetRewardContract = "0x79dD22579112d8a5F7347c5ED7E609e60da713C5";
  const rewardHashOwner = "0x878510cde784681e4d10ca3eae6a8495d06902d2";
  const managerAddress = "0x9e0bce7ec474b481492610eb9dd5d69eb03718d5";

  let owner;
  let tokemakRewardHashContract;
  let tokemakRewardContract;
  let tokeTokenContract;
  let tokeEthLPContract;
  let managerContract;

  let sushiRouter;
  let compounder;
  let expire_time = 9999999999;

  before(async () => {
    [owner] = await ethers.getSigners();
    await owner.sendTransaction({
      to: impersonatedAddressIPFSClaim,
      value: ethers.utils.parseEther("1.0"),
    });

    await owner.sendTransaction({
      to: rewardHashOwner,
      value: ethers.utils.parseEther("1.0"),
    });

    tokemakRewardHashContract = await hre.ethers.getContractAt(
      "ITokemakRewardHash",
      "0x5ec3EC6A8aC774c7d53665ebc5DDf89145d02fB6",
    );
    tokemakRewardContract = await hre.ethers.getContractAt(
      "ITokemakReward",
      "0x79dd22579112d8a5f7347c5ed7e609e60da713c5",
    );
    tokeTokenContract = await hre.ethers.getContractAt("IERC20", "0x2e9d63788249371f1dfc918a52f8d799f4a38c94");
    tokeEthLPContract = await hre.ethers.getContractAt("IERC20", "0xd4e7a6e2d03e4e48dfc27dd3f46df1c176647e38");
    sushiRouter = await hre.ethers.getContractAt("ISushiRouter", "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F");
    managerContract = await hre.ethers.getContractAt("IManager", "0xA86e412109f77c45a3BC1c5870b880492Fb86A14");
  });

  it("should correctly autocompound several times", async function () {
    // Use Mock Contract to mock a succesful claim from the rewards contract.
    // To use the mainnet contract, you would need a valid ipfs link with a valid signature.
    // Instead we send some TOKE to the compounder contract before a compound to simulate a claim.

    const TokemakCompounder = await ethers.getContractFactory("TokemakCompounderMock");

    const compounder = await TokemakCompounder.deploy();

    await sushiRouter.swapExactETHForTokens(0, [WETHAddress, tokeTokenContract.address], owner.address, expire_time, {
      value: ethers.utils.parseEther("1.0"),
    });

    await tokeTokenContract.approve(sushiRouter.address, ethers.utils.parseEther("10"));

    await sushiRouter.addLiquidityETH(
      tokeTokenContract.address,
      ethers.utils.parseEther("10"),
      0,
      0,
      owner.address,
      expire_time,
      { value: ethers.utils.parseEther("1.0") },
    );

    const lpAmount = await tokeEthLPContract.balanceOf(owner.address);
    await tokeEthLPContract.approve(compounder.address, ethers.utils.parseEther("1000000"));
    await compounder.deposit(lpAmount);

    for (let i = 0; i < 5; i++) {
      // Mock claiming Toke rewards by sending 5 TOKE to compounder
      await tokeTokenContract.transfer(compounder.address, ethers.utils.parseEther("5"));

      const recipient = {
        chainId: 1,
        cycle: 200,
        wallet: compounder.address,
        amount: 5,
      };

      const v = 27;
      const r = "0x5b9615ca09679832a51903117e75bb38f544660e6efe8e0785728ac86ceb72ad";
      const s = "0x6637221a3184c10d6761bbe07fc74d2764a149d4893bcf94fb3a08196ab661a1";

      const beforeLP = await compounder.depositedLP();
      await compounder.compound(recipient, v, r, s);
      const afterLP = await compounder.depositedLP();
      expect(afterLP).to.be.gt(beforeLP);
    }
  });

  it("should correctly withdraw", async function () {
    const TokemakCompounder = await ethers.getContractFactory("TokemakCompounderMock");

    const compounder = await TokemakCompounder.deploy();

    await sushiRouter.swapExactETHForTokens(0, [WETHAddress, tokeTokenContract.address], owner.address, expire_time, {
      value: ethers.utils.parseEther("1.0"),
    });

    await tokeTokenContract.approve(sushiRouter.address, ethers.utils.parseEther("10"));

    await sushiRouter.addLiquidityETH(
      tokeTokenContract.address,
      ethers.utils.parseEther("10"),
      0,
      0,
      owner.address,
      expire_time,
      { value: ethers.utils.parseEther("1.0") },
    );

    const lpAmount = await tokeEthLPContract.balanceOf(owner.address);
    await tokeEthLPContract.approve(compounder.address, ethers.utils.parseEther("1000000"));
    await compounder.deposit(lpAmount);

    const depositedAmount = await compounder.depositedLP();
    await compounder.initiateWithdrawal(depositedAmount);

    await expect(compounder.completeWithdrawal(depositedAmount)).to.be.revertedWith(
      "Must wait more cycles before withdrawing",
    );

    await expect(compounder.completeWithdrawal(depositedAmount + 1)).to.be.revertedWith(
      "Withdrawing more SLP than ready",
    );

    // Impersonate owner of hash contract to increase cycle index
    // The mainnet fork has a cycleIndex value of 224. This increases this value to 225 to allow for withdrawing.
    await tokemakRewardHashContract
      .connect(await impersonateAddress(rewardHashOwner))
      .setCycleHashes(
        225,
        "Qma3559RdvVKTUvudcAb9zfi1dPghyRoUWQsao3Nsx1wKC",
        "Qma3559RdvVKTUvudcAb9zfi1dPghyRoUWQsao3Nsx1wKC",
      );

    // Increase network time to deal with cycle time issues
    await hre.network.provider.send("evm_increaseTime", [360000000]);
    await network.provider.send("evm_mine");

    // Start next cycle on Manager contract -> 225
    await managerContract.connect(await impersonateAddress(rewardHashOwner)).startCycleRollover();
    await managerContract
      .connect(await impersonateAddress(managerAddress))
      .completeRollover("Qma3559RdvVKTUvudcAb9zfi1dPghyRoUWQsao3Nsx1wKC");

    await compounder.completeWithdrawal(depositedAmount);

    expect(await tokeEthLPContract.balanceOf(owner.address)).to.eq(depositedAmount);
  });

  it("should correctly get offchain data required to claim reward", async function () {
    const latestCycleIndex = await tokemakRewardHashContract.latestCycleIndex();
    const lastestClaimableString = await tokemakRewardHashContract.cycleHashes(latestCycleIndex);
    const data = await downloadFromIPFS(lastestClaimableString, impersonatedAddressIPFSClaim);
    const recipient = {
      chainId: data.payload.chainId,
      cycle: data.payload.cycle,
      wallet: data.payload.wallet,
      amount: data.payload.amount,
    };

    const beforeBalance = await tokeTokenContract.balanceOf(impersonatedAddressIPFSClaim);
    // Claim 3.23 Toke - replicating this tx by forking 1 block before
    // https://etherscan.io/tx/0x5e2a0836916377c6196ac74daae2c0a6b0442fb9c144f2406d1dfd755e882b9a
    await tokemakRewardContract
      .connect(await impersonateAddress(impersonatedAddressIPFSClaim))
      .claim(recipient, data.signature.v, data.signature.r, data.signature.s);
    const afterBalance = await tokeTokenContract.balanceOf(impersonatedAddressIPFSClaim);
    expect(afterBalance).to.be.gt(beforeBalance);
  });
});

// Function which allows to convert any address to the signer which can sign transactions in a test
const impersonateAddress = async address => {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [address],
  });
  const signer = await ethers.provider.getSigner(address);
  signer.address = signer._address;
  return signer;
};

// TODO: Fix using axios.get - getting 404 due to issue: invalid CID: selected encoding not supported\n issue
async function downloadFromIPFS(latestClaimableHash, walletAddress) {
  try {
    // const data = await axios.get(`https://cloudflare-ipfs.com/ipfs/${latestClaimableHash}/${walletAddress}.json`);
    // return data.data;
    return ipfsClaim;
  } catch (e) {
    console.log(e);
  }
}
