import {expect} from "./chai-setup";
import {BigNumber} from "ethers";
import {expandTo18Decimals, encodePrice} from "./shared/common";
import {pairDifferentWeightFixture} from "./shared/fixtures";
import {getLatestBlock,mineBlockTimeStamp} from "./shared/utilities";
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import {ethers} from "hardhat";
import {FireBirdFormula, FireBirdErc20, FireBirdFactory, FireBirdPair} from "../../typechain";
const overrides = {};

describe("FireBirdPairWeight", () => {
  let signers: SignerWithAddress[];

  let wallet: SignerWithAddress;
  let other: SignerWithAddress;

  let factory: FireBirdFactory;
  let token0: FireBirdErc20;
  let tokenA: FireBirdErc20;
  let formula: FireBirdFormula;
  let tokenWeight0: number;
  let token1: FireBirdErc20;
  let tokenB: FireBirdErc20;
  let tokenWeight1: number;
  let pair: FireBirdPair;

  beforeEach(async () => {
    signers = await ethers.getSigners();
    wallet = signers[0];
    other = signers[1];
    const fixture = await pairDifferentWeightFixture(wallet);
    factory = fixture.factory;
    token0 = fixture.token0;
    token1 = fixture.token1;
    tokenA = fixture.tokenA;
    tokenB = fixture.tokenB;
    tokenWeight0 = fixture.tokenWeight0;
    tokenWeight1 = fixture.tokenWeight1;
    pair = fixture.pair;
    formula = fixture.formula;
  });

  async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
    await token0.transfer(pair.address, token0Amount);
    await token1.transfer(pair.address, token1Amount);
    await pair.mint(wallet.address, overrides);
  }

  async function addWeightLiquidity(tokenAAmount: BigNumber, tokenBAmount: BigNumber) {
    await tokenA.transfer(pair.address, tokenAAmount);
    await tokenB.transfer(pair.address, tokenBAmount);
    await pair.mint(wallet.address, overrides);
  }

  const swapTestCases: BigNumber[][] = [
    [40, 500, 1000],
    [1, 10, 5],

    [2, 5, 10],
    [2, 10, 5],

    [1, 10, 10],
    [1, 100, 100],
    [1, 1000, 1000],
  ].map((a) => a.map((n) => expandTo18Decimals(n)));
  swapTestCases.forEach((swapTestCase, i) => {
    it(`getInputPrice:token0:${i}`, async () => {
      const [swapAmount, token0Amount, token1Amount] = swapTestCase;

      const expectedOutputAmount = BigNumber.from(await formula.getAmountOut(swapAmount, token0Amount, token1Amount, tokenWeight0, tokenWeight1, 40));
      await addLiquidity(token0Amount, token1Amount);
      await token0.transfer(pair.address, swapAmount);
      await expect(pair.swap(0, expectedOutputAmount.add(2), wallet.address, "0x", overrides)).to.be.revertedWith("FBP: K");
      await expect(pair.swap(swapAmount.add(1), expectedOutputAmount.add(2), wallet.address, "0x", overrides)).to.be.revertedWith("FBP: K");
      await pair.swap(0, expectedOutputAmount, wallet.address, "0x", overrides);
    });
    it(`getInputPrice:token1:${i}`, async () => {
      const [amountOut, token0Amount, token1Amount] = swapTestCase;

      const expectedInputAmountIn = await formula.getAmountIn(amountOut, token1Amount, token0Amount, tokenWeight1, tokenWeight0, 40);
      await addLiquidity(token0Amount, token1Amount);
      await token1.transfer(pair.address, expectedInputAmountIn);
      await expect(pair.swap(amountOut.add(5), 0, wallet.address, "0x", overrides)).to.be.revertedWith("FBP: K");
      await expect(pair.swap(amountOut.add(5), expectedInputAmountIn.add(1), wallet.address, "0x", overrides)).to.be.reverted;
      await pair.swap(amountOut, 0, wallet.address, "0x", overrides);
    });
  });

  const optimisticTestCases: BigNumber[][] = [
    ["996000000000000000", 5, 10, 1], // given amountIn, amountOut = floor(amountIn * .996)
    ["996000000000000000", 10, 5, 1],
    ["996000000000000000", 5, 5, 1],
    // [1, 5, 5, "1004016064257028112"], // given amountOut, amountIn = floor(amountOut / .996)
  ].map((a) => a.map((n) => (typeof n === "string" ? BigNumber.from(n) : expandTo18Decimals(n))));
  optimisticTestCases.forEach((optimisticTestCase, i) => {
    it(`optimistic:token0:${i}`, async () => {
      const [outputAmount, token0Amount, token1Amount, inputAmount] = optimisticTestCase;
      await addLiquidity(token0Amount, token1Amount);
      await token0.transfer(pair.address, inputAmount);
      await expect(pair.swap(outputAmount.add(1), 0, wallet.address, "0x", overrides)).to.be.revertedWith("FBP: K");
      await pair.swap(outputAmount, 0, wallet.address, "0x", overrides);
    });
    it(`optimistic:token1:${i}`, async () => {
      const [outputAmount, token0Amount, token1Amount, inputAmount] = optimisticTestCase;
      await addLiquidity(token0Amount, token1Amount);
      await token1.transfer(pair.address, inputAmount);
      await expect(pair.swap(0, outputAmount.add(1), wallet.address, "0x", overrides)).to.be.revertedWith("FBP: K");
      await pair.swap(0, outputAmount, wallet.address, "0x", overrides);
    });
  });

  it("swap:tokenA", async () => {
    const tokenAamount = expandTo18Decimals(5);
    const tokenBamount = expandTo18Decimals(10);
    await addWeightLiquidity(tokenAamount, tokenBamount);

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = BigNumber.from("5164587591416097612");
    await tokenA.transfer(pair.address, swapAmount);

    const isToken0Sorted = tokenA.address === token0.address;
    const syncArgs = isToken0Sorted
      ? [tokenAamount.add(swapAmount), tokenBamount.sub(expectedOutputAmount)]
      : [tokenBamount.sub(expectedOutputAmount), tokenAamount.add(swapAmount)];
    const swapArgs = isToken0Sorted ? [swapAmount, 0, 0, expectedOutputAmount] : [0, swapAmount, expectedOutputAmount, 0];

    await expect(pair.swap(isToken0Sorted ? 0 : expectedOutputAmount, isToken0Sorted ? expectedOutputAmount : 0, wallet.address, "0x", overrides))
      .to.emit(tokenB, "Transfer")
      .withArgs(pair.address, wallet.address, expectedOutputAmount)
      .to.emit(pair, "Sync")
      .withArgs(...syncArgs)
      .to.emit(pair, "Swap")
      .withArgs(wallet.address, ...swapArgs, wallet.address);

    const reserves = await pair.getReserves();
    expect(isToken0Sorted ? reserves[0] : reserves[1]).to.eq(tokenAamount.add(swapAmount));
    expect(isToken0Sorted ? reserves[1] : reserves[0]).to.eq(tokenBamount.sub(expectedOutputAmount));
    expect(await tokenA.balanceOf(pair.address)).to.eq(tokenAamount.add(swapAmount));
    expect(await tokenB.balanceOf(pair.address)).to.eq(tokenBamount.sub(expectedOutputAmount));
    const totalSupplyTokenA = await tokenA.totalSupply();
    const totalSupplyTokenB = await tokenB.totalSupply();
    expect(await tokenA.balanceOf(wallet.address)).to.eq(totalSupplyTokenA.sub(tokenAamount).sub(swapAmount));
    expect(await tokenB.balanceOf(wallet.address)).to.eq(totalSupplyTokenB.sub(tokenBamount).add(expectedOutputAmount));
  });

  it("swap:tokenB", async () => {
    const tokenAamount = expandTo18Decimals(5);
    const tokenBamount = expandTo18Decimals(10);
    await addWeightLiquidity(tokenAamount, tokenBamount);

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = BigNumber.from("117285607949537171");
    await tokenB.transfer(pair.address, swapAmount);

    const isToken0Sorted = tokenA.address === token0.address;
    const syncArgs = isToken0Sorted
      ? [tokenAamount.sub(expectedOutputAmount), tokenBamount.add(swapAmount)]
      : [tokenBamount.add(swapAmount), tokenAamount.sub(expectedOutputAmount)];
    const swapArgs = isToken0Sorted ? [0, swapAmount, expectedOutputAmount, 0] : [swapAmount, 0, 0, expectedOutputAmount];

    await expect(pair.swap(isToken0Sorted ? expectedOutputAmount : 0, isToken0Sorted ? 0 : expectedOutputAmount, wallet.address, "0x", overrides))
      .to.emit(tokenA, "Transfer")
      .withArgs(pair.address, wallet.address, expectedOutputAmount)
      .to.emit(pair, "Sync")
      .withArgs(...syncArgs)
      .to.emit(pair, "Swap")
      .withArgs(wallet.address, ...swapArgs, wallet.address);

    const reserves = await pair.getReserves();
    expect(isToken0Sorted ? reserves[0] : reserves[1]).to.eq(tokenAamount.sub(expectedOutputAmount));
    expect(isToken0Sorted ? reserves[1] : reserves[0]).to.eq(tokenBamount.add(swapAmount));
    expect(await tokenA.balanceOf(pair.address)).to.eq(tokenAamount.sub(expectedOutputAmount));
    expect(await tokenB.balanceOf(pair.address)).to.eq(tokenBamount.add(swapAmount));
    const totalSupplyTokenA = await tokenA.totalSupply();
    const totalSupplyTokenB = await tokenB.totalSupply();
    expect(await tokenA.balanceOf(wallet.address)).to.eq(totalSupplyTokenA.sub(tokenAamount).add(expectedOutputAmount));
    expect(await tokenB.balanceOf(wallet.address)).to.eq(totalSupplyTokenB.sub(tokenBamount).sub(swapAmount));
  });

  it('swap:gas', async () => {
    await factory.setFeeTo(other.address)
    await factory.setProtocolFee(50000)
    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addWeightLiquidity(token0Amount, token1Amount)

    // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
    await mineBlockTimeStamp(ethers, (await getLatestBlock(ethers)).timestamp + 1)
    await pair.sync(overrides)

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = BigNumber.from("1");
    await token1.transfer(pair.address, swapAmount)
    await mineBlockTimeStamp(ethers, (await getLatestBlock(ethers)).timestamp + 1)
    const isToken0Sorted = tokenA.address === token0.address;
    const tx = await pair.swap(isToken0Sorted ? 0 : expectedOutputAmount, isToken0Sorted ? expectedOutputAmount : 0, wallet.address, '0x', overrides)
    const receipt = await tx.wait()
    expect(receipt.gasUsed).to.eq(86129)
  })

  it("price{0,1}CumulativeLast", async () => {
    const tokenAamount = expandTo18Decimals(3);
    const tokenBamount = expandTo18Decimals(3);
    await addWeightLiquidity(tokenAamount, tokenBamount);

    const isToken0Sorted = tokenA.address === token0.address;

    const blockTimestamp = (await pair.getReserves())[2];
    await mineBlockTimeStamp(ethers, blockTimestamp + 1);
    await pair.sync(overrides);

    const initialPrice = encodePrice(tokenAamount, tokenBamount, 80);
    expect(await pair.price0CumulativeLast()).to.eq(isToken0Sorted ? initialPrice[0].mul(2) : initialPrice[1].mul(2));
    expect(await pair.price1CumulativeLast()).to.eq(isToken0Sorted ? initialPrice[1].mul(2) : initialPrice[0].mul(2));
    expect((await pair.getReserves())[2]).to.eq(blockTimestamp + 2);

    const swapAmount = expandTo18Decimals(3);
    await tokenA.transfer(pair.address, swapAmount);
    await mineBlockTimeStamp(ethers, blockTimestamp + 9);
    // swap to a new price eagerly instead of syncing
    isToken0Sorted
      ? await pair.swap(0, expandTo18Decimals(1), wallet.address, "0x", overrides)
      : await pair.swap(expandTo18Decimals(1), 0, wallet.address, "0x", overrides); // make the price nice

    expect(await pair.price0CumulativeLast()).to.eq(isToken0Sorted ? initialPrice[0].mul(10) : initialPrice[1].mul(10));
    expect(await pair.price1CumulativeLast()).to.eq(isToken0Sorted ? initialPrice[1].mul(10) : initialPrice[0].mul(10));
    expect((await pair.getReserves())[2]).to.eq(blockTimestamp + 10);

    await mineBlockTimeStamp(ethers, blockTimestamp + 19);
    await pair.sync(overrides);

    const newPrice = encodePrice(expandTo18Decimals(6), expandTo18Decimals(2), 80);
    expect(await (isToken0Sorted ? pair.price0CumulativeLast() : pair.price1CumulativeLast())).to.eq(initialPrice[0].mul(10).add(newPrice[0].mul(10)));
    expect(await (isToken0Sorted ? pair.price1CumulativeLast() : pair.price0CumulativeLast())).to.eq(initialPrice[1].mul(10).add(newPrice[1].mul(10)));
    expect((await pair.getReserves())[2]).to.eq(blockTimestamp + 20);
  });
  async function checkBalanceReserves() {
    const reserves = await pair.getReserves();
    const balance0 = await token0.balanceOf(pair.address)
    const balance1 = await token1.balanceOf(pair.address)
    expect(balance0).eq(reserves._reserve0)
    expect(balance1).eq(reserves._reserve1)
  }
  it('swap:sync,skim', async () => {
    await factory.setFeeTo(factory.address)
    await factory.setProtocolFee(0)

    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addLiquidity(token0Amount, token1Amount)
    const weights = await pair.getTokenWeights();
    const fee = await pair.getSwapFee();
    const swapAmountIn = expandTo18Decimals(1)

    for (let i = 0; i < 3; i++) {
      let reserves = await pair.getReserves();
      const expectedOutputAmount1 = await formula.getAmountOut(swapAmountIn, reserves._reserve0, reserves._reserve1, weights._tokenWeight0, weights._tokenWeight1, fee);
      await token0.transfer(pair.address, swapAmountIn)
      await pair.swap(0, expectedOutputAmount1, wallet.address, '0x', overrides)

      reserves = await pair.getReserves();
      const expectedOutputAmount0 = await formula.getAmountOut(expectedOutputAmount1, reserves._reserve1, reserves._reserve0, weights._tokenWeight1, weights._tokenWeight0, fee);
      await token1.transfer(pair.address, expectedOutputAmount1)
      await pair.swap(expectedOutputAmount0, 0, wallet.address, '0x', overrides)
    }
    await checkBalanceReserves();
    await pair.sync()
    await checkBalanceReserves();
    await pair.skim(wallet.address)
    await checkBalanceReserves();

    let beforeReserves = await pair.getReserves();
    await token0.transfer(pair.address, swapAmountIn)
    await token1.transfer(pair.address, swapAmountIn)
    await pair.sync()
    let afterReserves = await pair.getReserves();
    expect(afterReserves._reserve0).eq(beforeReserves._reserve0.add(swapAmountIn))
    expect(afterReserves._reserve1).eq(beforeReserves._reserve1.add(swapAmountIn))
    await checkBalanceReserves();
    await token0.transfer(pair.address, swapAmountIn)
    await token1.transfer(pair.address, swapAmountIn)
    beforeReserves = await pair.getReserves();
    await expect(() => pair.skim(wallet.address))
      .to.changeTokenBalance(token0, wallet, swapAmountIn)
      .to.changeTokenBalance(token1, wallet, swapAmountIn)
    afterReserves = await pair.getReserves();
    expect(afterReserves._reserve0).eq(beforeReserves._reserve0)
    expect(afterReserves._reserve1).eq(beforeReserves._reserve1)
    await checkBalanceReserves();
  })
  it('swap:token0:withProtocolFee', async () => {
    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addLiquidity(token0Amount, token1Amount)

    const swapAmount = expandTo18Decimals(1)
    await factory.setFeeTo(factory.address)
    await factory.setProtocolFee(50000)
    let swapFee = swapAmount.mul(await pair.getSwapFee());
    const expectedOutputAmount = BigNumber.from(await formula.getAmountOut(swapAmount, token0Amount, token1Amount, tokenWeight0, tokenWeight1, 40));
    await token0.transfer(pair.address, swapAmount)
    await expect(pair.swap(0, expectedOutputAmount, wallet.address, '0x', overrides))
      .to.emit(token1, 'Transfer')
      .withArgs(pair.address, wallet.address, expectedOutputAmount)
      .to.emit(token0, 'Transfer')
      .to.emit(pair, 'Sync')
      .withArgs(token0Amount.add(swapAmount), token1Amount.sub(expectedOutputAmount))
      .to.emit(pair, 'Swap')
      .withArgs(wallet.address, swapAmount, 0, 0, expectedOutputAmount, wallet.address)

    const reserves = await pair.getReserves()
    const balance0 = await token0.balanceOf(pair.address);
    const balance1 = await token1.balanceOf(pair.address);
    const collectedFees = await pair.getCollectedFees()
    expect(swapFee).to.eq(collectedFees._collectedFee0)
    expect(balance0).to.eq(reserves._reserve0)
    expect(balance1).to.eq(reserves._reserve1)
    expect(reserves[0]).to.eq(token0Amount.add(swapAmount))
    expect(reserves[1]).to.eq(token1Amount.sub(expectedOutputAmount))
    expect(balance0).to.eq(token0Amount.add(swapAmount))
    expect(balance1).to.eq(token1Amount.sub(expectedOutputAmount))
    const totalSupplyToken0 = await token0.totalSupply()
    const totalSupplyToken1 = await token1.totalSupply()
    expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(token0Amount).sub(swapAmount))
    expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(token1Amount).add(expectedOutputAmount))

  })
});
