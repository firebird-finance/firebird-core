import {expect} from "./chai-setup";
import {BigNumber, Contract} from "ethers";
import {ethers, network} from "hardhat";

import {expandTo18Decimals,MaxUint256} from "./shared/common";
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import {v2Fixture} from "./shared/fixtures";
import {getLatestBlock, maxUint256, mineBlock, toWei} from "./shared/utilities";
import {
  DeflatingErc20Factory,
  TestErc20Factory,
  OriginUniswapV2FactoryFactory,
  OriginUniswapV2PairFactory,
  FireBirdPairFactory, RouterEventEmitter, FireBirdRouter,
} from "../../typechain";

const overrides = {};

describe("FireBirdRouter", () => {
  let token0: Contract;
  let token1: Contract;
  let WETH: Contract;
  let WETHPartner: Contract;
  let factory: Contract;
  let router: FireBirdRouter;
  let pair: Contract;
  let WETHPair: Contract;
  let routerEventEmitter: RouterEventEmitter;
  let signers: SignerWithAddress[];

  let wallet: SignerWithAddress;
  let other: SignerWithAddress;
  let deployWallet: any;

  beforeEach(async function () {
    deployWallet = await ethers.Wallet.fromMnemonic((network.config.accounts as any).mnemonic);

    signers = await ethers.getSigners();
    wallet = signers[0];
    other = signers[1];
    const fixture = await v2Fixture(wallet, false);
    token0 = fixture.tokenA;
    token1 = fixture.tokenB;
    WETH = fixture.WETH;
    WETHPartner = fixture.WETHPartner;
    factory = fixture.factoryV2;
    router = fixture.router;
    pair = fixture.pair;
    WETHPair = fixture.WETHPair;
    routerEventEmitter = fixture.routerEventEmitter;
  });

  afterEach(async function () {
    expect(await ethers.provider.getBalance(router.address)).to.eq(0);
  });

  describe("swap with different weight", () => {
    async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
      await token0.transfer(pair.address, token0Amount);
      await token1.transfer(pair.address, token1Amount);
      await pair.mint(wallet.address, overrides);
    }

    describe("swapExactTokensForTokens", () => {
      const token0Amount = expandTo18Decimals(50);
      const token1Amount = expandTo18Decimals(100);
      const swapAmount = expandTo18Decimals(5);
      const expectedOutputAmount = BigNumber.from("31599216670248594850");

      beforeEach(async () => {
        await addLiquidity(token0Amount, token1Amount);
        await token0.approve(router.address, MaxUint256);
      });

      it("happy path", async () => {
        const isToken0Sorted = (await pair.token0()) === token0.address;
        const syncArgs = isToken0Sorted
          ? [token0Amount.add(swapAmount), token1Amount.sub(expectedOutputAmount)]
          : [token1Amount.sub(expectedOutputAmount), token0Amount.add(swapAmount)];
        const pairArgs = isToken0Sorted ? [swapAmount, 0, 0, expectedOutputAmount] : [0, swapAmount, expectedOutputAmount, 0];

        await expect(router.swapExactTokensForTokens(token0.address, token1.address, swapAmount, 0, [pair.address], wallet.address, MaxUint256, overrides))
          .to.emit(token0, "Transfer")
          .withArgs(wallet.address, pair.address, swapAmount)
          .to.emit(token1, "Transfer")
          .withArgs(pair.address, wallet.address, expectedOutputAmount)
          .to.emit(pair, "Sync")
          .withArgs(...syncArgs)
          .to.emit(pair, "Swap")
          .withArgs(router.address, ...pairArgs, wallet.address);
      });

      it("amounts", async () => {
        await token0.approve(routerEventEmitter.address, MaxUint256);
        await expect(
          routerEventEmitter.swapExactTokensForTokens(
            router.address,
            token0.address,
            token1.address,
            swapAmount,
            0,
            [pair.address],
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(routerEventEmitter, "Amounts")
          .withArgs([swapAmount, expectedOutputAmount]);
      });

      it("gas", async () => {
        await factory.setFeeTo(wallet.address);
        await factory.setProtocolFee(BigNumber.from(50000));

        // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
        await mineBlock(ethers, (await getLatestBlock(ethers)).timestamp + 1);
        await pair.sync(overrides);

        await mineBlock(ethers, (await getLatestBlock(ethers)).timestamp + 1);
        const tx = await router.swapExactTokensForTokens(
          token0.address,
          token1.address,
          swapAmount,
          0,
          [pair.address],
          wallet.address,
          MaxUint256,
          overrides
        );
        const receipt = await tx.wait();
        expect(receipt.gasUsed).to.eq(131373);
      });
    });

    describe("swapTokensForExactTokens", () => {
      const token0Amount = expandTo18Decimals(50);
      const token1Amount = expandTo18Decimals(100);
      const expectedSwapAmount = BigNumber.from("647886294174707190");
      const outputAmount = expandTo18Decimals(5);

      beforeEach(async () => {
        await addLiquidity(token0Amount, token1Amount);
      });

      it("happy path", async () => {
        const isToken0Sorted = (await pair.token0()) === token0.address;
        const syncArgs = isToken0Sorted
          ? [token0Amount.add(expectedSwapAmount), token1Amount.sub(outputAmount)]
          : [token1Amount.sub(outputAmount), token0Amount.add(expectedSwapAmount)];
        const pairArgs = isToken0Sorted ? [expectedSwapAmount, 0, 0, outputAmount] : [0, expectedSwapAmount, outputAmount];

        await token0.approve(router.address, MaxUint256);

        await expect(
          router.swapTokensForExactTokens(token0.address, token1.address, outputAmount, MaxUint256, [pair.address], wallet.address, MaxUint256, overrides)
        )
          .to.emit(token0, "Transfer")
          .withArgs(wallet.address, pair.address, expectedSwapAmount)
          .to.emit(token1, "Transfer")
          .withArgs(pair.address, wallet.address, outputAmount)
          .to.emit(pair, "Sync")
          .withArgs(...syncArgs)
          .to.emit(pair, "Swap")
          .withArgs(router.address, ...pairArgs, wallet.address);
      });

      it("amounts", async () => {
        await token0.approve(routerEventEmitter.address, MaxUint256);
        await expect(
          routerEventEmitter.swapTokensForExactTokens(
            router.address,
            token0.address,
            token1.address,
            outputAmount,
            MaxUint256,
            [pair.address],
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(routerEventEmitter, "Amounts")
          .withArgs([expectedSwapAmount, outputAmount]);
      });

      it("gas", async () => {
        await factory.setFeeTo(wallet.address);
        await factory.setProtocolFee(BigNumber.from(50000));

        // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
        await mineBlock(ethers, (await getLatestBlock(ethers)).timestamp + 1);
        await pair.sync(overrides);

        await mineBlock(ethers, (await getLatestBlock(ethers)).timestamp + 1);

        await token0.approve(router.address, MaxUint256);
        const tx = await router.swapTokensForExactTokens(
          token0.address,
          token1.address,
          outputAmount,
          MaxUint256,
          [pair.address],
          wallet.address,
          MaxUint256,
          overrides
        );
        const receipt = await tx.wait();
        expect(receipt.gasUsed).to.eq(130786);
      });
    });

    describe("swapExactETHForTokens", () => {
      const WETHPartnerAmount = expandTo18Decimals(100);
      const ETHAmount = expandTo18Decimals(50);
      const swapAmount = expandTo18Decimals(5);
      const expectedOutputAmount = BigNumber.from("31599216670248594850");

      beforeEach(async () => {
        await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount);
        await WETH.deposit({value: ETHAmount});
        await WETH.transfer(WETHPair.address, ETHAmount);
        await WETHPair.mint(wallet.address, overrides);

        await token0.approve(router.address, MaxUint256);
      });

      it("happy path", async () => {
        const WETHPairToken0 = await WETHPair.token0();
        await expect(
          router.swapExactETHForTokens(WETHPartner.address, 0, [WETHPair.address], wallet.address, MaxUint256,{
            ...overrides,
            value: swapAmount,
          })
        )
          .to.emit(WETH, "Transfer")
          .withArgs(router.address, WETHPair.address, swapAmount)
          .to.emit(WETHPartner, "Transfer")
          .withArgs(WETHPair.address, wallet.address, expectedOutputAmount)
          .to.emit(WETHPair, "Sync")
          .withArgs(
            WETHPairToken0 === WETHPartner.address ? WETHPartnerAmount.sub(expectedOutputAmount) : ETHAmount.add(swapAmount),
            WETHPairToken0 === WETHPartner.address ? ETHAmount.add(swapAmount) : WETHPartnerAmount.sub(expectedOutputAmount)
          )
          .to.emit(WETHPair, "Swap")
          .withArgs(
            router.address,
            WETHPairToken0 === WETHPartner.address ? 0 : swapAmount,
            WETHPairToken0 === WETHPartner.address ? swapAmount : 0,
            WETHPairToken0 === WETHPartner.address ? expectedOutputAmount : 0,
            WETHPairToken0 === WETHPartner.address ? 0 : expectedOutputAmount,
            wallet.address
          );
      });

      it("amounts", async () => {
        await expect(
          routerEventEmitter.swapExactETHForTokens(router.address, WETHPartner.address, 0, [WETHPair.address], wallet.address, MaxUint256, {
            ...overrides,
            value: swapAmount,
          })
        )
          .to.emit(routerEventEmitter, "Amounts")
          .withArgs([swapAmount, expectedOutputAmount]);
      });
    });

    describe("swapTokensForExactETH", () => {
      const WETHPartnerAmount = expandTo18Decimals(50);
      const ETHAmount = expandTo18Decimals(100);
      const expectedSwapAmount = BigNumber.from("11432613612190029754");
      const outputAmount = expandTo18Decimals(5);

      beforeEach(async () => {
        await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount);
        await WETH.deposit({value: ETHAmount});
        await WETH.transfer(WETHPair.address, ETHAmount);
        await WETHPair.mint(wallet.address, overrides);
      });

      it("happy path", async () => {
        await WETHPartner.approve(router.address, MaxUint256);
        const WETHPairToken0 = await WETHPair.token0();
        await expect(router.swapTokensForExactETH(WETHPartner.address, outputAmount, MaxUint256, [WETHPair.address], wallet.address, MaxUint256, overrides))
          .to.emit(WETHPartner, "Transfer")
          .withArgs(wallet.address, WETHPair.address, expectedSwapAmount)
          .to.emit(WETH, "Transfer")
          .withArgs(WETHPair.address, router.address, outputAmount)
          .to.emit(WETHPair, "Sync")
          .withArgs(
            WETHPairToken0 === WETHPartner.address ? WETHPartnerAmount.add(expectedSwapAmount) : ETHAmount.sub(outputAmount),
            WETHPairToken0 === WETHPartner.address ? ETHAmount.sub(outputAmount) : WETHPartnerAmount.add(expectedSwapAmount)
          )
          .to.emit(WETHPair, "Swap")
          .withArgs(
            router.address,
            WETHPairToken0 === WETHPartner.address ? expectedSwapAmount : 0,
            WETHPairToken0 === WETHPartner.address ? 0 : expectedSwapAmount,
            WETHPairToken0 === WETHPartner.address ? 0 : outputAmount,
            WETHPairToken0 === WETHPartner.address ? outputAmount : 0,
            router.address
          );
      });

      it("amounts", async () => {
        await WETHPartner.approve(routerEventEmitter.address, MaxUint256);
        await expect(
          routerEventEmitter.swapTokensForExactETH(
            router.address,
            WETHPartner.address,
            outputAmount,
            MaxUint256,
            [WETHPair.address],
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(routerEventEmitter, "Amounts")
          .withArgs([expectedSwapAmount, outputAmount]);
      });
    });

    describe("swapExactTokensForETH", () => {
      const WETHPartnerAmount = expandTo18Decimals(50);
      const ETHAmount = expandTo18Decimals(100);
      const swapAmount = expandTo18Decimals(5);
      const expectedOutputAmount = BigNumber.from("2345712158990743425");

      beforeEach(async () => {
        await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount);
        await WETH.deposit({value: ETHAmount});
        await WETH.transfer(WETHPair.address, ETHAmount);
        await WETHPair.mint(wallet.address, overrides);
      });

      it("happy path", async () => {
        await WETHPartner.approve(router.address, MaxUint256);
        const WETHPairToken0 = await WETHPair.token0();
        await expect(router.swapExactTokensForETH(WETHPartner.address, swapAmount, 0, [WETHPair.address], wallet.address, MaxUint256, overrides))
          .to.emit(WETHPartner, "Transfer")
          .withArgs(wallet.address, WETHPair.address, swapAmount)
          .to.emit(WETH, "Transfer")
          .withArgs(WETHPair.address, router.address, expectedOutputAmount)
          .to.emit(WETHPair, "Sync")
          .withArgs(
            WETHPairToken0 === WETHPartner.address ? WETHPartnerAmount.add(swapAmount) : ETHAmount.sub(expectedOutputAmount),
            WETHPairToken0 === WETHPartner.address ? ETHAmount.sub(expectedOutputAmount) : WETHPartnerAmount.add(swapAmount)
          )
          .to.emit(WETHPair, "Swap")
          .withArgs(
            router.address,
            WETHPairToken0 === WETHPartner.address ? swapAmount : 0,
            WETHPairToken0 === WETHPartner.address ? 0 : swapAmount,
            WETHPairToken0 === WETHPartner.address ? 0 : expectedOutputAmount,
            WETHPairToken0 === WETHPartner.address ? expectedOutputAmount : 0,
            router.address
          );
      });

      it("amounts", async () => {
        await WETHPartner.approve(routerEventEmitter.address, MaxUint256);
        await expect(
          routerEventEmitter.swapExactTokensForETH(
            router.address,
            WETHPartner.address,
            swapAmount,
            0,
            [WETHPair.address],
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(routerEventEmitter, "Amounts")
          .withArgs([swapAmount, expectedOutputAmount]);
      });
    });

    describe("swapETHForExactTokens", () => {
      const WETHPartnerAmount = expandTo18Decimals(100);
      const ETHAmount = expandTo18Decimals(50);
      const expectedSwapAmount = BigNumber.from("647886294174707190");
      const outputAmount = expandTo18Decimals(5);

      beforeEach(async () => {
        await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount);
        await WETH.deposit({value: ETHAmount});
        await WETH.transfer(WETHPair.address, ETHAmount);
        await WETHPair.mint(wallet.address, overrides);
      });

      it("happy path", async () => {
        const WETHPairToken0 = await WETHPair.token0();
        await expect(
          router.swapETHForExactTokens(WETHPartner.address, outputAmount, [WETHPair.address], wallet.address, MaxUint256, {
            ...overrides,
            value: expectedSwapAmount,
          })
        )
          .to.emit(WETH, "Transfer")
          .withArgs(router.address, WETHPair.address, expectedSwapAmount)
          .to.emit(WETHPartner, "Transfer")
          .withArgs(WETHPair.address, wallet.address, outputAmount)
          .to.emit(WETHPair, "Sync")
          .withArgs(
            WETHPairToken0 === WETHPartner.address ? WETHPartnerAmount.sub(outputAmount) : ETHAmount.add(expectedSwapAmount),
            WETHPairToken0 === WETHPartner.address ? ETHAmount.add(expectedSwapAmount) : WETHPartnerAmount.sub(outputAmount)
          )
          .to.emit(WETHPair, "Swap")
          .withArgs(
            router.address,
            WETHPairToken0 === WETHPartner.address ? 0 : expectedSwapAmount,
            WETHPairToken0 === WETHPartner.address ? expectedSwapAmount : 0,
            WETHPairToken0 === WETHPartner.address ? outputAmount : 0,
            WETHPairToken0 === WETHPartner.address ? 0 : outputAmount,
            wallet.address
          );
      });

      it("amounts", async () => {
        await expect(
          routerEventEmitter.swapETHForExactTokens(router.address, WETHPartner.address, outputAmount, [WETHPair.address], wallet.address, MaxUint256, {
            ...overrides,
            value: expectedSwapAmount,
          })
        )
          .to.emit(routerEventEmitter, "Amounts")
          .withArgs([expectedSwapAmount, outputAmount]);
      });
    });
  });
});

describe("fee-on-transfer tokens: reloaded", () => {
  let DTT: Contract;
  let DTT2: Contract;
  let router: Contract;
  let pair: Contract;
  let signers: SignerWithAddress[];

  let wallet: SignerWithAddress;
  let other: SignerWithAddress;
  let pairAddress: string;
  let deployWallet: any;
  beforeEach(async function () {
    deployWallet = await ethers.Wallet.fromMnemonic((network.config.accounts as any).mnemonic);

    signers = await ethers.getSigners();
    wallet = signers[0];
    other = signers[1];
    const fixture = await v2Fixture(wallet, false);

    router = fixture.router;

    DTT = await new DeflatingErc20Factory(wallet).deploy(toWei(10000));
    DTT2 = await new DeflatingErc20Factory(wallet).deploy(toWei(10000));

    // make a DTT<>DTT2 pair
    await fixture.factoryV2.createPair(DTT.address, DTT2.address, 70, 30);
    pairAddress = await fixture.factoryV2.getPair(DTT.address, DTT2.address, 70, 30);
    pair = FireBirdPairFactory.connect(pairAddress, wallet);
  });

  afterEach(async function () {
    expect(await ethers.provider.getBalance(router.address)).to.eq(0);
  });

  async function addLiquidity(DTTAmount: BigNumber, DTT2Amount: BigNumber) {
    await DTT.approve(router.address, MaxUint256);
    await DTT2.approve(router.address, MaxUint256);
    await router.addLiquidity(pairAddress, DTT.address, DTT2.address, DTTAmount, DTT2Amount, DTTAmount, DTT2Amount, wallet.address, MaxUint256, overrides);
  }

  describe("swapExactTokensForTokensSupportingFeeOnTransferTokens", () => {
    const DTTAmount = expandTo18Decimals(50).mul(100).div(99);
    const DTT2Amount = expandTo18Decimals(50);
    const amountIn = expandTo18Decimals(1);
    const expectedSwapAmount = BigNumber.from("2207107810206084472");

    beforeEach(async () => {
      await addLiquidity(DTTAmount, DTT2Amount);
    });

    it("DTT -> DTT2", async () => {
      await DTT.approve(router.address, MaxUint256);

      const isToken0Sorted = (await pair.token0()) === DTT.address;
      const pairArgs = isToken0Sorted ? [amountIn.mul(99).div(100), 0, 0, expectedSwapAmount] : [0, amountIn.mul(99).div(100), expectedSwapAmount, 0];

      await expect(
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
          DTT.address,
          DTT2.address,
          amountIn,
          0,
          [pairAddress],
          wallet.address,
          MaxUint256,
          overrides
        )
      )
        .to.emit(pair, "Swap")
        .withArgs(router.address, ...pairArgs, wallet.address);
    });
  });
});

describe("fee-on-transfer tokens", () => {
  let DTT: Contract;
  let WETH: Contract;
  let router: Contract;
  let pair: Contract;

  let signers: SignerWithAddress[];

  let wallet: SignerWithAddress;
  let other: SignerWithAddress;
  let deployWallet: any;
  beforeEach(async function () {
    deployWallet = await ethers.Wallet.fromMnemonic((network.config.accounts as any).mnemonic);

    signers = await ethers.getSigners();
    wallet = signers[0];
    other = signers[1];
    const fixture = await v2Fixture(wallet, false);

    WETH = fixture.WETH;
    router = fixture.router;

    DTT = await new DeflatingErc20Factory(wallet).deploy(toWei(10000));

    // make a DTT<>WETH pair
    await fixture.factoryV2.createPair(DTT.address, WETH.address, 70, 30);
    const pairAddress = await fixture.factoryV2.getPair(DTT.address, WETH.address, 70, 30);
    pair = FireBirdPairFactory.connect(pairAddress, wallet);
  });

  afterEach(async function () {
    expect(await ethers.provider.getBalance(router.address)).to.eq(0);
  });

  async function addLiquidity(DTTAmount: BigNumber, WETHAmount: BigNumber) {
    await DTT.approve(router.address, MaxUint256);
    await router.addLiquidityETH(pair.address, DTT.address, DTTAmount, DTTAmount, WETHAmount, wallet.address, MaxUint256, {
      ...overrides,
      value: WETHAmount,
    });
  }

  describe("swapExactTokensForTokensSupportingFeeOnTransferTokens", () => {
    const DTTAmount = expandTo18Decimals(50).mul(100).div(99);
    const ETHAmount = expandTo18Decimals(100);
    const amountIn = expandTo18Decimals(5);

    beforeEach(async () => {
      await addLiquidity(DTTAmount, ETHAmount);
    });

    it("DTT -> WETH", async () => {
      await DTT.approve(router.address, MaxUint256);
      const expectedSwapAmount = BigNumber.from("19719030382063947688");

      const isToken0Sorted = (await pair.token0()) === DTT.address;
      const pairArgs = isToken0Sorted ? [amountIn.mul(99).div(100), 0, 0, expectedSwapAmount] : [0, amountIn.mul(99).div(100), expectedSwapAmount, 0];

      await expect(
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
          DTT.address,
          WETH.address,
          amountIn,
          0,
          [pair.address],
          wallet.address,
          MaxUint256,
          overrides
        )
      )
        .to.emit(pair, "Swap")
        .withArgs(router.address, ...pairArgs, wallet.address);
    });

    // WETH -> DTT
    it("WETH -> DTT", async () => {
      const expectedSwapAmount = BigNumber.from("1031650348406437818");
      await WETH.deposit({value: amountIn}); // mint WETH
      await WETH.approve(router.address, MaxUint256);

      const isToken0Sorted = (await pair.token0()) === DTT.address;
      const pairArgs = isToken0Sorted ? [0, amountIn, expectedSwapAmount, 0] : [amountIn, 0, 0, expectedSwapAmount];

      await expect(
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
          WETH.address,
          DTT.address,
          amountIn,
          0,
          [pair.address],
          wallet.address,
          MaxUint256,
          overrides
        )
      )
        .to.emit(pair, "Swap")
        .withArgs(router.address, ...pairArgs, wallet.address);
    });
  });

  // ETH -> DTT
  it("swapExactETHForTokensSupportingFeeOnTransferTokens", async () => {
    const DTTAmount = expandTo18Decimals(100).mul(100).div(99);
    const ETHAmount = expandTo18Decimals(50);
    const swapAmount = expandTo18Decimals(5);
    const expectedSwapAmount = BigNumber.from("3991198924992352345");
    await addLiquidity(DTTAmount, ETHAmount);

    const isToken0Sorted = (await pair.token0()) === DTT.address;
    const pairArgs = isToken0Sorted ? [0, swapAmount, expectedSwapAmount, 0] : [swapAmount, 0, 0, expectedSwapAmount];

    await expect(
      router.swapExactETHForTokensSupportingFeeOnTransferTokens(DTT.address, 0, [pair.address], wallet.address, MaxUint256, {
        ...overrides,
        value: swapAmount,
      })
    )
      .to.emit(pair, "Swap")
      .withArgs(router.address, ...pairArgs, wallet.address);
  });

  // DTT -> ETH
  it("swapExactTokensForETHSupportingFeeOnTransferTokens", async () => {
    const DTTAmount = expandTo18Decimals(50).mul(100).div(99);
    const ETHAmount = expandTo18Decimals(100);
    const swapAmount = expandTo18Decimals(5);
    const expectedSwapAmount = BigNumber.from("19719030382063947688");

    await addLiquidity(DTTAmount, ETHAmount);
    await DTT.approve(router.address, MaxUint256);

    const isToken0Sorted = (await pair.token0()) === DTT.address;
    const pairArgs = isToken0Sorted ? [swapAmount.mul(99).div(100), 0, 0, expectedSwapAmount] : [0, swapAmount.mul(99).div(100), expectedSwapAmount, 0];

    await expect(
      router.swapExactTokensForETHSupportingFeeOnTransferTokens(DTT.address, swapAmount, 0, [pair.address], wallet.address, MaxUint256, overrides)
    )
      .to.emit(pair, "Swap")
      .withArgs(router.address, ...pairArgs, router.address);
  });
});

describe("tokens: multiple path", () => {
  let token0: Contract;
  let token1: Contract;
  let token2: Contract;
  let router: Contract;
  let pair: Contract;
  let pair2: Contract;
  let routerEventEmitter: RouterEventEmitter;
  let signers: SignerWithAddress[];

  let wallet: SignerWithAddress;
  let other: SignerWithAddress;
  let deployWallet: any;

  beforeEach(async function () {
    deployWallet = await ethers.Wallet.fromMnemonic((network.config.accounts as any).mnemonic);

    signers = await ethers.getSigners();
    wallet = signers[0];
    other = signers[1];
    const fixture = await v2Fixture(wallet, false);
    token0 = fixture.tokenA;
    token1 = fixture.tokenB;
    router = fixture.router;
    pair = fixture.pair;
    routerEventEmitter = fixture.routerEventEmitter;

    token2 = await new TestErc20Factory(wallet).deploy(toWei(10000));

    // make a token1<>token2 pair
    await fixture.factoryV2.createPair(token1.address, token2.address, 76, 30);
    const pair2Address = await fixture.factoryV2.getPair(token1.address, token2.address, 76, 30);
    pair2 = FireBirdPairFactory.connect(pair2Address, wallet);
  });

  afterEach(async function () {
    expect(await ethers.provider.getBalance(router.address)).to.eq(0);
  });

  describe("swap with different weight", () => {
    async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
      await token0.transfer(pair.address, token0Amount);
      await token1.transfer(pair.address, token1Amount);
      await pair.mint(wallet.address, overrides);
    }

    async function addLiquidityPair2(token1Amount: BigNumber, token2Amount: BigNumber) {
      await token1.transfer(pair2.address, token1Amount);
      await token2.transfer(pair2.address, token2Amount);
      await pair2.mint(wallet.address, overrides);
    }

    describe("swapExactTokensForTokens", () => {
      const token0Amount = expandTo18Decimals(50);
      const token1Amount = expandTo18Decimals(100);
      const token2Amount = expandTo18Decimals(100);
      const swapAmount = expandTo18Decimals(5);
      const expectedOutput1Amount = BigNumber.from("31599216670248594850");
      const expectedOutput2Amount = BigNumber.from("57989720779692850382");

      beforeEach(async () => {
        await addLiquidity(token0Amount, token1Amount);
        await addLiquidityPair2(token1Amount, token2Amount);
        await token0.approve(router.address, MaxUint256);
      });

      it("happy path", async () => {
        const isToken0Sorted = (await pair.token0()) === token0.address;
        const syncArgs1 = isToken0Sorted
          ? [token0Amount.add(swapAmount), token1Amount.sub(expectedOutput1Amount)]
          : [token1Amount.sub(expectedOutput1Amount), token0Amount.add(swapAmount)];
        const pairArgs1 = isToken0Sorted ? [swapAmount, 0, 0, expectedOutput1Amount] : [0, swapAmount, expectedOutput1Amount, 0];

        const isToken1Sorted = (await pair2.token0()) === token1.address;
        const syncArgs2 = isToken1Sorted
          ? [token1Amount.add(expectedOutput1Amount), token2Amount.sub(expectedOutput2Amount)]
          : [token2Amount.sub(expectedOutput2Amount), token1Amount.add(expectedOutput1Amount)];
        const pairArgs2 = isToken1Sorted ? [expectedOutput1Amount, 0, 0, expectedOutput2Amount] : [0, expectedOutput1Amount, expectedOutput2Amount, 0];

        await expect(
          router.swapExactTokensForTokens(
            token0.address,
            token2.address,
            swapAmount,
            0,
            [pair.address, pair2.address],
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(token0, "Transfer")
          .withArgs(wallet.address, pair.address, swapAmount)
          .to.emit(token1, "Transfer")
          .withArgs(pair.address, pair2.address, expectedOutput1Amount)
          .to.emit(token2, "Transfer")
          .withArgs(pair2.address, wallet.address, expectedOutput2Amount)
          .to.emit(pair, "Sync")
          .withArgs(...syncArgs1)
          .to.emit(pair2, "Sync")
          .withArgs(...syncArgs2)
          .to.emit(pair, "Swap")
          .withArgs(router.address, ...pairArgs1, pair2.address)
          .to.emit(pair2, "Swap")
          .withArgs(router.address, ...pairArgs2, wallet.address);
      });

      it("amounts", async () => {
        await token0.approve(routerEventEmitter.address, MaxUint256);
        await expect(
          routerEventEmitter.swapExactTokensForTokens(
            router.address,
            token0.address,
            token2.address,
            swapAmount,
            0,
            [pair.address, pair2.address],
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(routerEventEmitter, "Amounts")
          .withArgs([swapAmount, expectedOutput1Amount, expectedOutput2Amount]);
      });
    });

    describe("swapTokensForExactTokens", () => {
      const token0Amount = expandTo18Decimals(50);
      const token1Amount = expandTo18Decimals(100);
      const token2Amount = expandTo18Decimals(100);
      const expectedSwap1Amount = BigNumber.from("207689151504738650");
      const expectedSwap2Amount = BigNumber.from("1637891607189822934");
      const outputAmount = expandTo18Decimals(5);

      beforeEach(async () => {
        await addLiquidity(token0Amount, token1Amount);
        await addLiquidityPair2(token1Amount, token2Amount);
      });

      it("happy path", async () => {
        const isToken0Sorted = (await pair.token0()) === token0.address;
        const syncArgs1 = isToken0Sorted
          ? [token0Amount.add(expectedSwap1Amount), token1Amount.sub(expectedSwap2Amount)]
          : [token1Amount.sub(expectedSwap2Amount), token0Amount.add(expectedSwap1Amount)];
        const pairArgs1 = isToken0Sorted ? [expectedSwap1Amount, 0, 0, expectedSwap2Amount] : [0, expectedSwap1Amount, expectedSwap2Amount, 0];

        const isToken1Sorted = (await pair2.token0()) === token1.address;
        const syncArgs2 = isToken1Sorted
          ? [token1Amount.add(expectedSwap2Amount), token2Amount.sub(outputAmount)]
          : [token2Amount.sub(outputAmount), token1Amount.add(expectedSwap2Amount)];
        const pairArgs2 = isToken1Sorted ? [expectedSwap2Amount, 0, 0, outputAmount] : [0, expectedSwap2Amount, outputAmount, 0];

        await token0.approve(router.address, MaxUint256);
        await expect(
          router.swapTokensForExactTokens(
            token0.address,
            token2.address,
            outputAmount,
            MaxUint256,
            [pair.address, pair2.address],
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(token0, "Transfer")
          .withArgs(wallet.address, pair.address, expectedSwap1Amount)
          .to.emit(token1, "Transfer")
          .withArgs(pair.address, pair2.address, expectedSwap2Amount)
          .to.emit(token2, "Transfer")
          .withArgs(pair2.address, wallet.address, outputAmount)
          .to.emit(pair, "Sync")
          .withArgs(...syncArgs1)
          .to.emit(pair2, "Sync")
          .withArgs(...syncArgs2)
          .to.emit(pair, "Swap")
          .withArgs(router.address, ...pairArgs1, pair2.address)
          .to.emit(pair2, "Swap")
          .withArgs(router.address, ...pairArgs2, wallet.address);
      });

      it("amounts", async () => {
        await token0.approve(routerEventEmitter.address, MaxUint256);
        await expect(
          routerEventEmitter.swapTokensForExactTokens(
            router.address,
            token0.address,
            token2.address,
            outputAmount,
            MaxUint256,
            [pair.address, pair2.address],
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(routerEventEmitter, "Amounts")
          .withArgs([expectedSwap1Amount, expectedSwap2Amount, outputAmount]);
      });
    });
  });
});

describe("fee-on-transfer tokens: multiple path", () => {
  let DTT: Contract;
  let DTT2: Contract;
  let DTT3: Contract;
  let token0: Contract;
  let router: Contract;
  let pair1: Contract;
  let pair2: Contract;
  let pair3: Contract;
  let pair4: Contract;
  let signers: SignerWithAddress[];

  let wallet: SignerWithAddress;
  let other: SignerWithAddress;
  let deployWallet: any;
  beforeEach(async function () {
    deployWallet = await ethers.Wallet.fromMnemonic((network.config.accounts as any).mnemonic);

    signers = await ethers.getSigners();
    wallet = signers[0];
    other = signers[1];
    const fixture = await v2Fixture(wallet, false);

    router = fixture.router;

    DTT = await new DeflatingErc20Factory(wallet).deploy(toWei(10000));
    DTT2 = await new DeflatingErc20Factory(wallet).deploy(toWei(10000));
    DTT3 = await new DeflatingErc20Factory(wallet).deploy(toWei(10000));
    token0 = await new TestErc20Factory(wallet).deploy(toWei(10000));

    // make a DTT<>DTT2 pair
    await fixture.factoryV2.createPair(DTT.address, DTT2.address, 70, 30);
    const pair1Address = await fixture.factoryV2.getPair(DTT.address, DTT2.address, 70, 30);
    pair1 = FireBirdPairFactory.connect(pair1Address, wallet);

    // make a DTT2<>DTT3 pair
    await fixture.factoryV2.createPair(DTT2.address, DTT3.address, 50, 30);
    const pair2Address = await fixture.factoryV2.getPair(DTT2.address, DTT3.address, 50, 30);
    pair2 = FireBirdPairFactory.connect(pair2Address, wallet);

    // make a DTT<>token0 pair
    await fixture.factoryV2.createPair(DTT.address, token0.address, 80, 30);
    const pair3Address = await fixture.factoryV2.getPair(DTT.address, token0.address, 80, 30);
    pair3 = FireBirdPairFactory.connect(pair3Address, wallet);

    // make a DTT2<>token0 pair
    await fixture.factoryV2.createPair(DTT2.address, token0.address, 60, 30);
    const pair4Address = await fixture.factoryV2.getPair(DTT2.address, token0.address, 60, 30);
    pair4 = FireBirdPairFactory.connect(pair4Address, wallet);
  });

  afterEach(async function () {
    expect(await ethers.provider.getBalance(router.address)).to.eq(0);
  });

  async function addLiquidity(token0: Contract, token1: Contract, token0Amount: BigNumber, token1Amount: BigNumber, pair: Contract) {
    await token0.approve(router.address, MaxUint256);
    await token1.approve(router.address, MaxUint256);
    await router.addLiquidity(
      pair.address,
      token0.address,
      token1.address,
      token0Amount,
      token1Amount,
      token0Amount,
      token1Amount,
      wallet.address,
      MaxUint256,
      overrides
    );
  }

  describe("swapExactTokensForTokensSupportingFeeOnTransferTokens between DTT", () => {
    const DTTAmount = expandTo18Decimals(50).mul(100).div(99);
    const DTT2Amount = expandTo18Decimals(50);
    const DTT3Amount = expandTo18Decimals(50);
    const amountIn = expandTo18Decimals(1);
    const expectedSwap1Amount = BigNumber.from("2207107810206084472");
    const expectedSwap2Amount = BigNumber.from("2066653473472406945");

    beforeEach(async () => {
      await addLiquidity(DTT, DTT2, DTTAmount, DTT2Amount, pair1);
      await addLiquidity(DTT2, DTT3, DTT2Amount.mul(100).div(99), DTT3Amount, pair2);
    });

    it("DTT -> DTT2 -> DTT3", async () => {
      const isToken0Sorted = (await pair1.token0()) === DTT.address;
      const pairArgs1 = isToken0Sorted ? [amountIn.mul(99).div(100), 0, 0, expectedSwap1Amount] : [0, amountIn.mul(99).div(100), expectedSwap1Amount, 0];

      const isToken1Sorted = (await pair2.token0()) === DTT2.address;
      const pairArgs2 = isToken1Sorted
        ? [expectedSwap1Amount.mul(99).div(100).add(1), 0, 0, expectedSwap2Amount]
        : [0, expectedSwap1Amount.mul(99).div(100).add(1), expectedSwap2Amount, 0];

      await DTT.approve(router.address, MaxUint256);

      await expect(
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
          DTT.address,
          DTT3.address,
          amountIn,
          0,
          [pair1.address, pair2.address],
          wallet.address,
          MaxUint256,
          overrides
        )
      )
        .to.emit(pair1, "Swap")
        .withArgs(router.address, ...pairArgs1, pair2.address)
        .to.emit(pair2, "Swap")
        .withArgs(router.address, ...pairArgs2, wallet.address);
    });
  });

  describe("swapExactTokensForTokensSupportingFeeOnTransferTokens between none DTT", () => {
    const DTTAmount = expandTo18Decimals(50).mul(100).div(99);
    const token0Amount = expandTo18Decimals(50);
    const DTT2Amount = expandTo18Decimals(50).mul(100).div(99);
    const amountIn = expandTo18Decimals(1);
    const expectedSwap1Amount = BigNumber.from("3760709493989250447");
    const expectedSwap2Amount = BigNumber.from("2353158927195499007");

    beforeEach(async () => {
      await addLiquidity(DTT, token0, DTTAmount, token0Amount, pair3);
      await addLiquidity(DTT2, token0, DTT2Amount, token0Amount, pair4);
    });

    it("DTT -> token0 -> DTT2", async () => {
      const isToken0Sorted = (await pair3.token0()) === DTT.address;
      const pairArgs3 = isToken0Sorted ? [amountIn.mul(99).div(100), 0, 0, expectedSwap1Amount] : [0, amountIn.mul(99).div(100), expectedSwap1Amount, 0];

      const isToken1Sorted = (await pair4.token0()) === token0.address;
      const pairArgs4 = isToken1Sorted ? [expectedSwap1Amount, 0, 0, expectedSwap2Amount] : [0, expectedSwap1Amount, expectedSwap2Amount, 0];

      await DTT.approve(router.address, MaxUint256);

      await expect(
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
          DTT.address,
          DTT2.address,
          amountIn,
          0,
          [pair3.address, pair4.address],
          wallet.address,
          MaxUint256,
          overrides
        )
      )
        .to.emit(pair3, "Swap")
        .withArgs(router.address, ...pairArgs3, pair4.address)
        .to.emit(pair4, "Swap")
        .withArgs(router.address, ...pairArgs4, wallet.address);
    });
  });
});

describe("tokens: multiple path with one is original uniswap 0.25% fee", () => {
  let token0: Contract;
  let token1: Contract;
  let token2: Contract;
  let router: Contract;
  let pair: Contract;
  let pair2: Contract;
  let routerEventEmitter: Contract;
  let signers: SignerWithAddress[];

  let wallet: SignerWithAddress;
  let other: SignerWithAddress;
  let deployWallet: any;

  beforeEach(async function () {
    deployWallet = await ethers.Wallet.fromMnemonic((network.config.accounts as any).mnemonic);

    signers = await ethers.getSigners();
    wallet = signers[0];
    other = signers[1];
    const fixture = await v2Fixture(wallet, false);
    token0 = fixture.tokenA;
    token1 = fixture.tokenB;
    router = fixture.router;
    pair = fixture.pair;
    routerEventEmitter = fixture.routerEventEmitter;

    token2 = await new TestErc20Factory(wallet).deploy(toWei(10000));

    // make a token1<>token2 original uni-pair
    const originFactory = await new OriginUniswapV2FactoryFactory(wallet).deploy(wallet.address);

    await originFactory.createPair(token1.address, token2.address);
    const pair2Address = await originFactory.getPair(token1.address, token2.address);
    pair2 = OriginUniswapV2PairFactory.connect(pair2Address, wallet);
  });

  afterEach(async function () {
    expect(await ethers.provider.getBalance(router.address)).to.eq(0);
  });

  describe("swap with different weight", () => {
    async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
      await token0.transfer(pair.address, token0Amount);
      await token1.transfer(pair.address, token1Amount);
      await pair.mint(wallet.address, overrides);
    }

    async function addLiquidityPair2(token1Amount: BigNumber, token2Amount: BigNumber) {
      await token1.transfer(pair2.address, token1Amount);
      await token2.transfer(pair2.address, token2Amount);
      await pair2.mint(wallet.address, overrides);
    }

    describe("swapExactTokensForTokens", () => {
      const token0Amount = expandTo18Decimals(50);
      const token1Amount = expandTo18Decimals(100);
      const token2Amount = expandTo18Decimals(70);
      const swapAmount = expandTo18Decimals(5);
      const expectedOutput1Amount = BigNumber.from("31599216670248594850");
      const expectedOutput2Amount = BigNumber.from("16776244192775094406");

      beforeEach(async () => {
        await addLiquidity(token0Amount, token1Amount);
        await addLiquidityPair2(token1Amount, token2Amount);
        await token0.approve(router.address, MaxUint256);
      });

      it("happy path origin uni", async () => {
        const expectedOutputAmount = BigNumber.from("3325395880461959757");
        await token1.approve(router.address, MaxUint256);
        const isToken1Sorted = (await pair2.token0()) === token1.address;

        const syncArgs = isToken1Sorted
          ? [token1Amount.add(swapAmount), token2Amount.sub(expectedOutputAmount)]
          : [token2Amount.sub(expectedOutputAmount), token1Amount.add(swapAmount)];
        const pairArgs = isToken1Sorted ? [swapAmount, 0, 0, expectedOutputAmount] : [0, swapAmount, expectedOutputAmount, 0];

        await expect(router.swapExactTokensForTokens(token1.address, token2.address, swapAmount, 0, [pair2.address], wallet.address, MaxUint256, overrides))
          .to.emit(token1, "Transfer")
          .withArgs(wallet.address, pair2.address, swapAmount)
          .to.emit(token2, "Transfer")
          .withArgs(pair2.address, wallet.address, expectedOutputAmount)
          .to.emit(pair2, "Sync")
          .withArgs(...syncArgs)
          .to.emit(pair2, "Swap")
          .withArgs(router.address, ...pairArgs, wallet.address);
      });

      it("happy path", async () => {
        const isToken0Sorted = (await pair.token0()) === token0.address;
        const syncArgs1 = isToken0Sorted
          ? [token0Amount.add(swapAmount), token1Amount.sub(expectedOutput1Amount)]
          : [token1Amount.sub(expectedOutput1Amount), token0Amount.add(swapAmount)];
        const pairArgs1 = isToken0Sorted ? [swapAmount, 0, 0, expectedOutput1Amount] : [0, swapAmount, expectedOutput1Amount, 0];

        const isToken1Sorted = (await pair2.token0()) === token1.address;
        const syncArgs2 = isToken1Sorted
          ? [token1Amount.add(expectedOutput1Amount), token2Amount.sub(expectedOutput2Amount)]
          : [token2Amount.sub(expectedOutput2Amount), token1Amount.add(expectedOutput1Amount)];
        const pairArgs2 = isToken1Sorted ? [expectedOutput1Amount, 0, 0, expectedOutput2Amount] : [0, expectedOutput1Amount, expectedOutput2Amount, 0];

        await expect(
          router.swapExactTokensForTokens(
            token0.address,
            token2.address,
            swapAmount,
            0,
            [pair.address, pair2.address],
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(token0, "Transfer")
          .withArgs(wallet.address, pair.address, swapAmount)
          .to.emit(token1, "Transfer")
          .withArgs(pair.address, pair2.address, expectedOutput1Amount)
          .to.emit(token2, "Transfer")
          .withArgs(pair2.address, wallet.address, expectedOutput2Amount)
          .to.emit(pair, "Sync")
          .withArgs(...syncArgs1)
          .to.emit(pair2, "Sync")
          .withArgs(...syncArgs2)
          .to.emit(pair, "Swap")
          .withArgs(router.address, ...pairArgs1, pair2.address)
          .to.emit(pair2, "Swap")
          .withArgs(router.address, ...pairArgs2, wallet.address);
      });

      it("amounts", async () => {
        await token0.approve(routerEventEmitter.address, MaxUint256);
        await expect(
          routerEventEmitter.swapExactTokensForTokens(
            router.address,
            token0.address,
            token2.address,
            swapAmount,
            0,
            [pair.address, pair2.address],
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(routerEventEmitter, "Amounts")
          .withArgs([swapAmount, expectedOutput1Amount, expectedOutput2Amount]);
      });

      it("gas old pair", async () => {
        // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
        await mineBlock(ethers, (await getLatestBlock(ethers)).timestamp + 1);
        await pair2.sync(overrides);

        await token1.approve(router.address, maxUint256);
        await mineBlock(ethers, (await getLatestBlock(ethers)).timestamp + 1);
        const tx = await router.swapExactTokensForTokens(
          token1.address,
          token2.address,
          swapAmount,
          0,
          [pair2.address],
          wallet.address,
          MaxUint256,
          overrides
        );
        const receipt = await tx.wait();
        expect(receipt.gasUsed).to.eq(110286);
      });

      it("gas 2 pair (1 old 1 new)", async () => {
        // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
        await mineBlock(ethers, (await getLatestBlock(ethers)).timestamp + 1);
        await pair.sync(overrides);

        await mineBlock(ethers, (await getLatestBlock(ethers)).timestamp + 1);
        const tx = await router.swapExactTokensForTokens(
          token0.address,
          token2.address,
          swapAmount,
          0,
          [pair.address, pair2.address],
          wallet.address,
          MaxUint256,
          overrides
        );
        const receipt = await tx.wait();
        expect(receipt.gasUsed).to.eq(225166);
      });
    });

    describe("swapTokensForExactTokens", () => {
      const token0Amount = expandTo18Decimals(50);
      const token1Amount = expandTo18Decimals(100);
      const token2Amount = expandTo18Decimals(100);
      const expectedSwap1Amount = BigNumber.from("684932547246084647");
      const expectedSwap2Amount = BigNumber.from("5276348766653475795");
      const outputAmount = expandTo18Decimals(5);

      beforeEach(async () => {
        await addLiquidity(token0Amount, token1Amount);
        await addLiquidityPair2(token1Amount, token2Amount);
      });

      it("happy path", async () => {
        const isToken0Sorted = (await pair.token0()) === token0.address;
        const syncArgs1 = isToken0Sorted
          ? [token0Amount.add(expectedSwap1Amount), token1Amount.sub(expectedSwap2Amount)]
          : [token1Amount.sub(expectedSwap2Amount), token0Amount.add(expectedSwap1Amount)];
        const pairArgs1 = isToken0Sorted ? [expectedSwap1Amount, 0, 0, expectedSwap2Amount] : [0, expectedSwap1Amount, expectedSwap2Amount, 0];

        const isToken1Sorted = (await pair2.token0()) === token1.address;
        const syncArgs2 = isToken1Sorted
          ? [token1Amount.add(expectedSwap2Amount), token2Amount.sub(outputAmount)]
          : [token2Amount.sub(outputAmount), token1Amount.add(expectedSwap2Amount)];
        const pairArgs2 = isToken1Sorted ? [expectedSwap2Amount, 0, 0, outputAmount] : [0, expectedSwap2Amount, outputAmount, 0];

        await token0.approve(router.address, MaxUint256);
        await expect(
          router.swapTokensForExactTokens(
            token0.address,
            token2.address,
            outputAmount,
            MaxUint256,
            [pair.address, pair2.address],
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(token0, "Transfer")
          .withArgs(wallet.address, pair.address, expectedSwap1Amount)
          .to.emit(token1, "Transfer")
          .withArgs(pair.address, pair2.address, expectedSwap2Amount)
          .to.emit(token2, "Transfer")
          .withArgs(pair2.address, wallet.address, outputAmount)
          .to.emit(pair, "Sync")
          .withArgs(...syncArgs1)
          .to.emit(pair2, "Sync")
          .withArgs(...syncArgs2)
          .to.emit(pair, "Swap")
          .withArgs(router.address, ...pairArgs1, pair2.address)
          .to.emit(pair2, "Swap")
          .withArgs(router.address, ...pairArgs2, wallet.address);
      });

      it("amounts", async () => {
        await token0.approve(routerEventEmitter.address, MaxUint256);
        await expect(
          routerEventEmitter.swapTokensForExactTokens(
            router.address,
            token0.address,
            token2.address,
            outputAmount,
            MaxUint256,
            [pair.address, pair2.address],
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(routerEventEmitter, "Amounts")
          .withArgs([expectedSwap1Amount, expectedSwap2Amount, outputAmount]);
      });
    });
  });
});
