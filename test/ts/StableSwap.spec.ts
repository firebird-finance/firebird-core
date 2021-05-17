import { expect } from "./chai-setup";
import { BigNumber, Contract } from "ethers";
import { expandTo18Decimals, encodePrice, MaxUint256 } from "./shared/common";
import { pairFixture, stableFixture } from "./shared/fixtures";
import {
  maxUint256,
  mineBlockTimeStamp,
  toWei
} from "./shared/utilities";
import { SignerWithAddress } from "hardhat-deploy-ethers/dist/src/signer-with-address";
import { ethers } from "hardhat";
import { StableSwapFactory, TestErc20, Swap, LpToken, StableSwapRouter } from "../../typechain";

const overrides = {};

describe("FireBirdStable", () => {
  let signers: SignerWithAddress[];

  let wallet: SignerWithAddress;
  let other: SignerWithAddress;

  let factory: StableSwapFactory;
  let token0: Contract;
  let token1: Contract;
  let token2: Contract;
  let swap: Swap;
  let linkSwap: Swap;
  let swapLp: LpToken;
  let linkSwapLp: LpToken;
  let stableSwapRouter: StableSwapRouter;
  beforeEach(async () => {
    signers = await ethers.getSigners();
    wallet = signers[0];
    other = signers[1];
    const fixture = await stableFixture(wallet);
    factory = fixture.stableFactory;
    token0 = fixture.firstToken;
    token1 = fixture.secondToken;
    token2 = fixture.thirdToken;
    swap = fixture.swap;
    linkSwap = fixture.linkSwap;
    swapLp = fixture.swapToken;
    linkSwapLp = fixture.linkSwapToken;
    stableSwapRouter = fixture.stableSwapRouter;

    await token0.approve(swap.address, maxUint256);
    await token1.approve(swap.address, maxUint256);
    await token2.approve(swap.address, maxUint256);

    await token0.approve(linkSwap.address, maxUint256);
    await token1.approve(linkSwap.address, maxUint256);
    await token2.approve(linkSwap.address, maxUint256);
    await swapLp.approve(linkSwap.address, maxUint256);
    await linkSwapLp.approve(linkSwap.address, maxUint256);

    await token0.approve(stableSwapRouter.address, maxUint256);
    await token1.approve(stableSwapRouter.address, maxUint256);
    await token2.approve(stableSwapRouter.address, maxUint256);
    await swapLp.approve(stableSwapRouter.address, maxUint256);
    await linkSwapLp.approve(stableSwapRouter.address, maxUint256);


  });

  async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
    await swap.addLiquidity([token0Amount, token1Amount], 0, maxUint256);
  }

  it("add liq", async () => {
    await swap.addLiquidity([toWei(1000), toWei(1000)], 0, maxUint256);
  });
  it("add liq router", async () => {
    await swap.addLiquidity([toWei(100), toWei(100)], 0, maxUint256);
    expect(await swapLp.balanceOf(wallet.address)).to.eq(toWei(200));
    await linkSwap.addLiquidity([toWei(100), toWei(100)], 0, maxUint256);

    await stableSwapRouter.addLiquidity(
      linkSwap.address, swap.address, [toWei(0), toWei(10)], [toWei(10), toWei(10)], 0, maxUint256
    );

    await stableSwapRouter.addLiquidity(
      linkSwap.address, swap.address, [toWei(10), toWei(0)], [toWei(10), toWei(10)], 0, maxUint256
    );
    await stableSwapRouter.addLiquidity(
      linkSwap.address, swap.address, [toWei(10), toWei(10)], [0, 0], 0, maxUint256
    );
    await stableSwapRouter.addLiquidity(
      linkSwap.address, swap.address, [toWei(10), toWei(10)], [10, 10], 0, maxUint256
    );

    await stableSwapRouter.removeLiquidity(linkSwap.address, swap.address, 100, [0, 0], [0, 0], maxUint256);

    await stableSwapRouter.removeBaseLiquidityOneToken(linkSwap.address, swap.address, 10, 1, 0, maxUint256);
    await stableSwapRouter.calculateRemoveBaseLiquidityOneToken(linkSwap.address, swap.address, 10, 1);
    await stableSwapRouter.calculateTokenAmount(linkSwap.address, swap.address, [toWei(10), toWei(10)], [10, 10], false);

    await stableSwapRouter.calculateSwapFromBase(linkSwap.address, swap.address, 0, 0, toWei(1));
    await stableSwapRouter.calculateSwapFromBase(linkSwap.address, swap.address, 0, 1, toWei(1));
    await stableSwapRouter.calculateSwapFromBase(linkSwap.address, swap.address, 1, 0, toWei(1));
    await stableSwapRouter.calculateSwapToBase(linkSwap.address, swap.address, 0, 0, toWei(1));
    await stableSwapRouter.calculateSwapToBase(linkSwap.address, swap.address, 0, 1, toWei(1));
    await stableSwapRouter.calculateSwapToBase(linkSwap.address, swap.address, 1, 0, toWei(1));
    await stableSwapRouter.calculateRemoveLiquidity(linkSwap.address, swap.address, toWei(1));


    await stableSwapRouter.swapFromBase(linkSwap.address, swap.address, 0, 0, toWei(0.0001), 0, maxUint256);
    await stableSwapRouter.swapFromBase(linkSwap.address, swap.address, 0, 1, toWei(0.0001), 0, maxUint256);
    await stableSwapRouter.swapFromBase(linkSwap.address, swap.address, 1, 0, toWei(0.0001), 0, maxUint256);
    await stableSwapRouter.swapToBase(linkSwap.address, swap.address, 0, 0, toWei(0.0001), 0, maxUint256);
    await stableSwapRouter.swapToBase(linkSwap.address, swap.address, 0, 1, toWei(0.0001), 0, maxUint256);
    await stableSwapRouter.swapToBase(linkSwap.address, swap.address, 1, 0, toWei(0.0001), 0, maxUint256);

  });
  it("removeLiquidity link router", async () => {
    await swap.addLiquidity([toWei(100), toWei(100)], 0, maxUint256);
    expect(await swapLp.balanceOf(wallet.address)).to.eq(toWei(200));
    await linkSwap.addLiquidity([toWei(100), toWei(100)], 0, maxUint256);

    await stableSwapRouter.addLiquidity(
      linkSwap.address, swap.address, [toWei(0), toWei(10)], [toWei(10), toWei(10)], 0, maxUint256
    );


    let amounts = await stableSwapRouter.calculateRemoveLiquidity(linkSwap.address, swap.address, toWei(1));

    await stableSwapRouter.removeLiquidity(linkSwap.address, swap.address, toWei(1), amounts.meta_amounts, amounts.base_amounts, maxUint256);


  });

  it("removeBaseLiquidityOneToken link router", async () => {
    await swap.addLiquidity([toWei(100), toWei(100)], 0, maxUint256);
    expect(await swapLp.balanceOf(wallet.address)).to.eq(toWei(200));
    await linkSwap.addLiquidity([toWei(100), toWei(100)], 0, maxUint256);

    await stableSwapRouter.addLiquidity(
      linkSwap.address, swap.address, [toWei(0), toWei(10)], [toWei(10), toWei(10)], 0, maxUint256
    );


    let amount0 = await stableSwapRouter.calculateRemoveBaseLiquidityOneToken(linkSwap.address, swap.address, toWei(1), 0);

    await stableSwapRouter.removeBaseLiquidityOneToken(linkSwap.address, swap.address, toWei(1), 0, amount0, maxUint256);


    let amount1 = await stableSwapRouter.calculateRemoveBaseLiquidityOneToken(linkSwap.address, swap.address, toWei(1), 1);

    await stableSwapRouter.removeBaseLiquidityOneToken(linkSwap.address, swap.address, toWei(1), 1, amount1, maxUint256);


  });

  it("convert lp", async () => {
    await swap.addLiquidity([toWei(100), toWei(100)], 0, maxUint256);
    expect(await swapLp.balanceOf(wallet.address)).to.eq(toWei(200));
    expect(await stableSwapRouter.calculateConvert(swap.address, swap.address, toWei(1))).to.eq(toWei(1));
    await stableSwapRouter.convert(swap.address, swap.address, toWei(1), 0, maxUint256);
    expect(await swapLp.balanceOf(wallet.address)).to.eq(toWei("199.994975000628124921"));
  });


  it("swap", async () => {
    await addLiquidity(toWei(1000), toWei(1000));
    await swap.swap(0, 1, toWei(100), 0, maxUint256);
  });

  it("remove liq", async () => {
    await addLiquidity(toWei(1000), toWei(1000));
    await swap.removeLiquidity(toWei(0.1), [0, 0], maxUint256);
  });

  it("remove liq one token", async () => {
    await addLiquidity(toWei(1000), toWei(1000));
    const amountLp = await swap.calculateRemoveLiquidityOneToken(wallet.address, toWei(1), 1);
    await swap.removeLiquidityOneToken(amountLp, 1, 0, maxUint256);
  });

  it("remove liq imbalance", async () => {
    await addLiquidity(toWei(1000), toWei(1000));
    await swap.removeLiquidityImbalance([toWei(1), toWei(1)], await swapLp.totalSupply(), maxUint256);
  });
});
