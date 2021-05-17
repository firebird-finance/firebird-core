import {expect} from "./chai-setup";
import {BigNumber, Contract} from "ethers";
import {ethers, network} from "hardhat";

import {expandTo18Decimals, MaxUint256} from "./shared/common";
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import {v2Fixture} from "./shared/fixtures";
import {ADDRESS_ZERO, maxUint256, toWei} from "./shared/utilities";
import {
    TestErc20Factory,
    OriginUniswapV2FactoryFactory,
    OriginUniswapV2PairFactory,
    FireBirdZapFactory,
    FireBirdZap,
    UniswapV2Router02Factory,
} from "../../typechain";
import { keccak256 } from "ethers/lib/utils";

const overrides = {};

describe("FireBirdZap", () => {
    let token0: Contract;
    let token1: Contract;
    let token2: Contract;
    let WETH: Contract;
    let WETHPartner: Contract;
    let factory: Contract;
    let router: Contract;
    let pair: Contract;
    let pairUni: Contract;
    let pairUniETH: Contract;
    let WETHPair: Contract;
    let zap: FireBirdZap;
    let signers: SignerWithAddress[];
    let BNBAddress = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

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

        token2 = await new TestErc20Factory(wallet).deploy(toWei(10000));
        // make a token1<>token2 original uni-pair
        const originFactory = await new OriginUniswapV2FactoryFactory(wallet).deploy(wallet.address);
        await originFactory.createPair(token1.address, token2.address);
        const pairUniAddress = await originFactory.getPair(token1.address, token2.address);
        pairUni = OriginUniswapV2PairFactory.connect(pairUniAddress, wallet);

        // make a token2<>weth original uni-pair
        await originFactory.createPair(token2.address, WETH.address);
        const pairUniETHAddress = await originFactory.getPair(token2.address, WETH.address);
        pairUniETH = OriginUniswapV2PairFactory.connect(pairUniETHAddress, wallet);
        const uniRouter = await new UniswapV2Router02Factory(wallet).deploy(originFactory.address, WETH.address);

        //Deploy zapper
        zap = await new FireBirdZapFactory(wallet).deploy(uniRouter.address,router.address);
        await zap.setMaxResidual(10000);
    });

    async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
        await token0.transfer(pair.address, token0Amount);
        await token1.transfer(pair.address, token1Amount);
        await pair.mint(wallet.address, overrides);
    }

    async function addLiquidityETH(ETHAmount: BigNumber, WETHPartnerAmount: BigNumber) {
        await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount);
        await WETH.deposit({value: ETHAmount});
        await WETH.transfer(WETHPair.address, ETHAmount);
        await WETHPair.mint(wallet.address, overrides);
    }

    async function addLiquidityUniPair(token1Amount: BigNumber, token2Amount: BigNumber) {
        await token1.transfer(pairUni.address, token1Amount);
        await token2.transfer(pairUni.address, token2Amount);
        await pairUni.mint(wallet.address, overrides);
    }

    async function addLiquidityUniETHPair(ETHAmount: BigNumber, token2Amount: BigNumber) {
        await token2.transfer(pairUniETH.address, token2Amount);
        await WETH.deposit({value: ETHAmount});
        await WETH.transfer(pairUniETH.address, ETHAmount);
        await pairUniETH.mint(wallet.address, overrides);
    }

    describe("zap token", () => {
        let wallet0Before: BigNumber, wallet0After: BigNumber;
        let wallet1Before: BigNumber, wallet1After: BigNumber;
        let wallet2Before: BigNumber, wallet2After: BigNumber;
        let walletPairBefore: BigNumber, walletPairAfter: BigNumber;
        let zap0Before: BigNumber, zap0After: BigNumber;
        let zap1Before: BigNumber, zap1After: BigNumber;
        let zap2Before: BigNumber, zap2After: BigNumber;
        let zapPairBefore: BigNumber, zapPairAfter: BigNumber;

        const getBalance = async (pair: Contract) => {
            let wallet0 = await token0.balanceOf(wallet.address);
            let wallet1 = await token1.balanceOf(wallet.address);
            let wallet2 = await token2.balanceOf(wallet.address);
            let walletPair = await pair.balanceOf(wallet.address);
            let zap0 = await token0.balanceOf(zap.address);
            let zap1 = await token1.balanceOf(zap.address);
            let zap2 = await token2.balanceOf(zap.address);
            let zapPair = await pair.balanceOf(zap.address);

            return {
                wallet0,
                wallet1,
                wallet2,
                walletPair,
                zap0,
                zap1,
                zap2,
                zapPair,
            };
        };

        const getBalanceBefore = async (pair: Contract) => {
            const balances = await getBalance(pair);
            wallet0Before = balances.wallet0;
            wallet1Before = balances.wallet1;
            wallet2Before = balances.wallet2;
            walletPairBefore = balances.walletPair;
            zap0Before = balances.zap0;
            zap1Before = balances.zap1;
            zap2Before = balances.zap2;
            zapPairBefore = balances.zapPair;
        };

        const getBalanceAfter = async (pair: Contract) => {
            const balances = await getBalance(pair);
            wallet0After = balances.wallet0;
            wallet1After = balances.wallet1;
            wallet2After = balances.wallet2;
            walletPairAfter = balances.walletPair;
            zap0After = balances.zap0;
            zap1After = balances.zap1;
            zap2After = balances.zap2;
            zapPairAfter = balances.zapPair;
        };

        describe("zap in", () => {
            beforeEach(async () => {
                await addLiquidity(expandTo18Decimals(100), expandTo18Decimals(100));
                await token0.approve(zap.address, MaxUint256);
            });

            it("zap in token", async () => {
                await getBalanceBefore(pair);
                await zap.zapInToken(token0.address, [toWei(5), 0, 0], pair.address, false);
                await getBalanceAfter(pair);

                expect(wallet0Before.sub(wallet0After)).is.eq(toWei(5));
                expect(wallet1Before).is.eq(wallet1After);
                expect(walletPairAfter).is.gt(walletPairBefore);
                expect(zap0After).is.gte(zap0Before);
                expect(zap1After).is.gte(zap1Before);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap in token return dust", async () => {
                await getBalanceBefore(pair);
                await zap.zapInToken(token0.address, [toWei(5), 0, 0], pair.address, true);
                await getBalanceAfter(pair);

                expect(wallet0Before.sub(wallet0After)).is.lte(toWei(5));
                expect(wallet1After).is.gte(wallet1Before);
                expect(walletPairAfter).is.gt(walletPairBefore);
                expect(zap0After).is.eq(zap0Before);
                expect(zap1After).is.eq(zap1Before);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap in not path", async () => {
                await WETHPartner.approve(zap.address, MaxUint256);
                await expect(zap.zapInToken(WETHPartner.address, [toWei(1), 0, 0], pair.address, false)).to.be.revertedWith("FireBirdZap: !path TokenBNB");
            });

            it("zap in uni pair", async () => {
                await addLiquidityUniPair(toWei(100), toWei(100));
                await token2.approve(zap.address, maxUint256);

                await getBalanceBefore(pairUni);
                await zap.zapInToken(token2.address, [toWei(5), 0, 0], pairUni.address, false);
                await getBalanceAfter(pairUni);

                expect(wallet2Before.sub(wallet2After)).is.eq(toWei(5));
                expect(wallet1Before).is.eq(wallet1After);
                expect(walletPairAfter).is.gt(walletPairBefore);
                expect(zap2After).is.gte(zap2Before);
                expect(zap1After).is.gte(zap1Before);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap in uni pair return dust", async () => {
                await addLiquidityUniPair(toWei(100), toWei(100));
                await token2.approve(zap.address, maxUint256);

                await getBalanceBefore(pairUni);
                await zap.zapInToken(token2.address, [toWei(5), 0, 0], pairUni.address, true);
                await getBalanceAfter(pairUni);

                expect(wallet2Before.sub(wallet2After)).is.lte(toWei(5));
                expect(wallet1Before).is.lte(wallet1After);
                expect(walletPairAfter).is.gt(walletPairBefore);
                expect(zap2After).is.eq(zap2Before);
                expect(zap1After).is.eq(zap1Before);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });
        });

        describe("zap out", () => {
            beforeEach(async () => {
                await addLiquidity(expandTo18Decimals(100), expandTo18Decimals(100));
                await pair.approve(zap.address, MaxUint256);
            });

            it("zap out to pair", async () => {
                await getBalanceBefore(pair);
                await zap.zapOutToPair(pair.address, toWei(1));
                await getBalanceAfter(pair);

                expect(wallet0Before).is.lt(wallet0After);
                expect(wallet1Before).is.lt(wallet1After);
                expect(walletPairBefore.sub(walletPairAfter)).is.eq(toWei(1));
                expect(zap0After).is.eq(zap0Before);
                expect(zap1After).is.eq(zap1Before);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap out uni to pair", async () => {
                await addLiquidityUniPair(toWei(100), toWei(100));
                await pairUni.approve(zap.address, maxUint256);

                await getBalanceBefore(pairUni);
                await zap.zapOutToPair(pairUni.address, toWei(1));
                await getBalanceAfter(pairUni);

                expect(wallet2Before).is.lt(wallet2After);
                expect(wallet1Before).is.lt(wallet1After);
                expect(walletPairBefore.sub(walletPairAfter)).is.eq(toWei(1));
                expect(zap0After).is.eq(zap0Before);
                expect(zap1After).is.eq(zap1Before);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap out to token", async () => {
                await getBalanceBefore(pair);
                await zap.zapOut(pair.address, toWei(1), token0.address, 0);
                await getBalanceAfter(pair);

                expect(wallet0Before).is.lt(wallet0After);
                expect(wallet1Before).is.eq(wallet1After);
                expect(walletPairBefore.sub(walletPairAfter)).is.eq(toWei(1));
                expect(zap0After).is.eq(zap0Before);
                expect(zap1After).is.eq(zap1Before);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap out not path", async () => {
                await expect(zap.zapOut(pair.address, toWei(1), WETHPartner.address, 0)).to.be.revertedWith("FireBirdZap: !path swap");
            });

            it("zap out uni pair to token", async () => {
                await addLiquidityUniPair(toWei(100), toWei(100));
                await pairUni.approve(zap.address, maxUint256);

                await getBalanceBefore(pairUni);
                await zap.zapOut(pairUni.address, toWei(1), token2.address, 0);
                await getBalanceAfter(pairUni);

                expect(wallet2Before).is.lt(wallet2After);
                expect(wallet1Before).is.eq(wallet1After);
                expect(walletPairBefore.sub(walletPairAfter)).is.eq(toWei(1));
                expect(zap2After).is.eq(zap2Before);
                expect(zap1After).is.eq(zap1Before);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap out with path", async () => {
                await addLiquidityUniPair(toWei(100), toWei(100));
                await zap.setFireBirdPairs(token0.address, token2.address, [pair.address, pairUni.address]);
                await zap.setFireBirdPairs(token1.address, token2.address, [pairUni.address]);

                await getBalanceBefore(pair);
                await zap.zapOut(pair.address, toWei(1), token2.address, 0);
                await getBalanceAfter(pair);

                expect(wallet2Before).is.lt(wallet2After);
                expect(wallet1Before).is.eq(wallet1After);
                expect(wallet0Before).is.eq(wallet0After);
                expect(walletPairBefore.sub(walletPairAfter)).is.eq(toWei(1));
                expect(zap0After).is.eq(zap0Before);
                expect(zap1After).is.eq(zap1Before);
                expect(zap2After).is.eq(zap2Before);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });
        });
    });

    describe("zap eth", () => {
        let ethBefore: BigNumber, ethAfter: BigNumber;
        let ethPartnerBefore: BigNumber, ethPartnerAfter: BigNumber;
        let wallet2Before: BigNumber, wallet2After: BigNumber;
        let walletPairBefore: BigNumber, walletPairAfter: BigNumber;
        let zapETHBefore: BigNumber, zapETHAfter: BigNumber;
        let zapPartnerBefore: BigNumber, zapPartnerAfter: BigNumber;
        let zap2Before: BigNumber, zap2After: BigNumber;
        let zapPairBefore: BigNumber, zapPairAfter: BigNumber;

        const getBalance = async (pair: Contract) => {
            let eth = await ethers.provider.getBalance(wallet.address);
            let ethPartner = await WETHPartner.balanceOf(wallet.address);
            let wallet2 = await token2.balanceOf(wallet.address);
            let walletPair = await pair.balanceOf(wallet.address);
            let zapETH = await ethers.provider.getBalance(zap.address);
            let zapPartner = await WETHPartner.balanceOf(zap.address);
            let zap2 = await token2.balanceOf(zap.address);
            let zapPair = await pair.balanceOf(zap.address);

            return {
                eth,
                ethPartner,
                wallet2,
                walletPair,
                zapETH,
                zapPartner,
                zap2,
                zapPair,
            };
        };

        const getBalanceBefore = async (pair: Contract) => {
            const balances = await getBalance(pair);
            ethBefore = balances.eth;
            ethPartnerBefore = balances.ethPartner;
            wallet2Before = balances.wallet2;
            walletPairBefore = balances.walletPair;
            zapETHBefore = balances.zapETH;
            zapPartnerBefore = balances.zapPartner;
            zap2Before = balances.zap2;
            zapPairBefore = balances.zapPair;
        };

        const getBalanceAfter = async (pair: Contract) => {
            const balances = await getBalance(pair);
            ethAfter = balances.eth;
            ethPartnerAfter = balances.ethPartner;
            wallet2After = balances.wallet2;
            walletPairAfter = balances.walletPair;
            zapETHAfter = balances.zapETH;
            zapPartnerAfter = balances.zapPartner;
            zap2After = balances.zap2;
            zapPairAfter = balances.zapPair;
        };

        describe("zap in", () => {
            beforeEach(async () => {
                await addLiquidityETH(expandTo18Decimals(10), expandTo18Decimals(80));
                await WETHPartner.approve(zap.address, MaxUint256);
            });

            it("zap in token", async () => {
                await getBalanceBefore(WETHPair);
                await zap.zapInToken(WETHPartner.address, [toWei(3), 0, 0], WETHPair.address, false);
                await getBalanceAfter(WETHPair);

                expect(ethBefore).is.gt(ethAfter);
                expect(ethPartnerBefore.sub(ethPartnerAfter)).is.eq(toWei(3));
                expect(walletPairAfter).is.gt(walletPairBefore);
                expect(zapETHAfter).is.gte(zapETHBefore);
                expect(zapPartnerAfter).is.gte(zapPartnerBefore);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap in eth", async () => {
                await getBalanceBefore(WETHPair);
                await zap.zapIn(WETHPair.address, 0, 0, false, {
                    ...overrides,
                    value: toWei(0.8),
                });
                await getBalanceAfter(WETHPair);

                expect(ethBefore.sub(ethAfter)).is.gt(toWei(0.8));
                expect(ethPartnerBefore).is.eq(ethPartnerAfter);
                expect(walletPairAfter).is.gt(walletPairBefore);
                expect(zapETHAfter).is.gte(zapETHBefore);
                expect(zapPartnerAfter).is.gte(zapPartnerBefore);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap in eth return dust", async () => {
                await getBalanceBefore(WETHPair);
                await zap.zapIn(WETHPair.address, 0, 0, true, {
                    ...overrides,
                    value: toWei(0.8),
                });
                await getBalanceAfter(WETHPair);

                expect(ethBefore.sub(ethAfter)).is.gt(toWei(0.8));
                expect(ethPartnerBefore).is.lte(ethPartnerAfter);
                expect(walletPairAfter).is.gt(walletPairBefore);
                expect(zapETHAfter).is.eq(zapETHBefore);
                expect(zapPartnerAfter).is.eq(zapPartnerBefore);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap in eth not path", async () => {
                await expect(
                    zap.zapIn(pair.address, 0, 0, false, {
                        ...overrides,
                        value: toWei(0.8),
                    })
                ).to.be.revertedWith("FireBirdZap: !path BNBToken");
            });

            it("zap in uni eth", async () => {
                await addLiquidityUniETHPair(toWei(10), toWei(100));

                await getBalanceBefore(pairUniETH);
                await zap.zapIn(pairUniETH.address, 0, 0, false, {
                    ...overrides,
                    value: toWei(0.8),
                });
                await getBalanceAfter(pairUniETH);

                expect(ethBefore.sub(ethAfter)).is.gt(toWei(0.8));
                expect(wallet2Before).is.eq(wallet2After);
                expect(walletPairAfter).is.gt(walletPairBefore);
                expect(zapETHAfter).is.gte(zapETHBefore);
                expect(zap2After).is.gte(zap2Before);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap in uni eth return dust", async () => {
                await addLiquidityUniETHPair(toWei(10), toWei(100));

                await getBalanceBefore(pairUniETH);
                await zap.zapIn(pairUniETH.address, 0, 0, true, {
                    ...overrides,
                    value: toWei(0.8),
                });
                await getBalanceAfter(pairUniETH);

                expect(ethBefore.sub(ethAfter)).is.gt(toWei(0.8));
                expect(wallet2Before).is.lte(wallet2After);
                expect(walletPairAfter).is.gt(walletPairBefore);
                expect(zapETHAfter).is.eq(zapETHBefore);
                expect(zap2After).is.eq(zap2Before);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap in with path", async () => {
                await addLiquidityUniETHPair(toWei(10), toWei(100));
                await zap.setFireBirdPairs(WETHPartner.address, WETH.address, [WETHPair.address]);

                await getBalanceBefore(pairUniETH);
                await zap.zapInToken(WETHPartner.address, [toWei(3), 0, 0], pairUniETH.address, false);
                await getBalanceAfter(pairUniETH);

                expect(ethBefore).is.gt(ethAfter);
                expect(wallet2Before).is.eq(wallet2After);
                expect(ethPartnerBefore.sub(ethPartnerAfter)).is.eq(toWei(3));
                expect(walletPairAfter).is.gt(walletPairBefore);
                expect(zapETHAfter).is.gte(zapETHBefore);
                expect(zap2After).is.gte(zap2Before);
                expect(zapPartnerAfter).is.eq(zapPartnerBefore);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap in with path return dust", async () => {
                await token2.approve(zap.address, maxUint256);
                await addLiquidityUniETHPair(toWei(10), toWei(100));
                await zap.setFireBirdPairs(token2.address, WETH.address, [pairUniETH.address]);

                await getBalanceBefore(WETHPair);
                await zap.zapInToken(token2.address, [toWei(3), 0, 0], WETHPair.address, true);
                await getBalanceAfter(WETHPair);

                expect(wallet2Before.sub(wallet2After)).is.eq(toWei(3));
                expect(ethBefore).is.gte(ethAfter);
                expect(ethPartnerBefore).is.lte(ethPartnerAfter);
                expect(walletPairAfter).is.gt(walletPairBefore);
                expect(zapETHAfter).is.eq(zapETHBefore);
                expect(zap2After).is.eq(zap2Before);
                expect(zapPartnerAfter).is.eq(zapPartnerBefore);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });
        });

        describe("zap out", () => {
            beforeEach(async () => {
                await addLiquidityETH(expandTo18Decimals(10), expandTo18Decimals(80));
                await WETHPair.approve(zap.address, MaxUint256);
            });

            it("zap out to pair", async () => {
                await getBalanceBefore(WETHPair);
                await zap.zapOutToPair(WETHPair.address, toWei(1));
                await getBalanceAfter(WETHPair);

                expect(ethBefore).is.lt(ethAfter);
                expect(ethPartnerBefore).is.lt(ethPartnerAfter);
                expect(walletPairBefore.sub(walletPairAfter)).is.eq(toWei(1));
                expect(zapETHAfter).is.eq(zapETHBefore);
                expect(zapPartnerAfter).is.eq(zapPartnerBefore);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap out to token", async () => {
                await getBalanceBefore(WETHPair);
                await zap.zapOut(WETHPair.address, toWei(1), WETHPartner.address, 0);
                await getBalanceAfter(WETHPair);

                expect(ethBefore).is.gt(ethAfter);
                expect(ethPartnerBefore).is.lt(ethPartnerAfter);
                expect(walletPairBefore.sub(walletPairAfter)).is.eq(toWei(1));
                expect(zapETHAfter).is.eq(zapETHBefore);
                expect(zapPartnerAfter).is.eq(zapPartnerBefore);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap out to ETH", async () => {
                await getBalanceBefore(WETHPair);
                await zap.zapOut(WETHPair.address, toWei(1), BNBAddress, 0);
                await getBalanceAfter(WETHPair);

                expect(ethBefore).is.lt(ethAfter);
                expect(ethPartnerBefore).is.eq(ethPartnerAfter);
                expect(walletPairBefore.sub(walletPairAfter)).is.eq(toWei(1));
                expect(zapETHAfter).is.eq(zapETHBefore);
                expect(zapPartnerAfter).is.eq(zapPartnerBefore);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap out not path", async () => {
                await expect(zap.zapOut(WETHPair.address, toWei(1), token0.address, 0)).to.be.revertedWith("FireBirdZap: !path swap");
            });

            it("zap out uni ETH pair", async () => {
                await addLiquidityUniETHPair(toWei(10), toWei(100));
                await pairUniETH.approve(zap.address, maxUint256);

                await getBalanceBefore(pairUniETH);
                await zap.zapOut(pairUniETH.address, toWei(1), BNBAddress, 0);
                await getBalanceAfter(pairUniETH);

                expect(ethBefore).is.lt(ethAfter);
                expect(wallet2Before).is.eq(wallet2After);
                expect(walletPairBefore.sub(walletPairAfter)).is.eq(toWei(1));
                expect(zapETHAfter).is.eq(zapETHBefore);
                expect(zap2After).is.eq(zap2Before);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });

            it("zap out with path", async () => {
                await addLiquidityUniETHPair(toWei(10), toWei(100));
                await zap.setFireBirdPairs(WETH.address, token2.address, [pairUniETH.address]);
                await zap.setFireBirdPairs(WETHPartner.address, token2.address, [WETHPair.address, pairUniETH.address]);

                await getBalanceBefore(WETHPair);
                await zap.zapOut(WETHPair.address, toWei(1), token2.address, 0);
                await getBalanceAfter(WETHPair);

                expect(ethBefore).is.gt(ethAfter);
                expect(wallet2Before).is.lt(wallet2After);
                expect(ethPartnerBefore).is.eq(ethPartnerAfter);
                expect(walletPairBefore.sub(walletPairAfter)).is.eq(toWei(1));
                expect(zapETHAfter).is.eq(zapETHBefore);
                expect(zap2After).is.eq(zap2Before);
                expect(zapPartnerAfter).is.eq(zapPartnerBefore);
                expect(zapPairAfter).is.eq(zapPairBefore);
            });
        });

        describe("withdraw dust", () => {
            beforeEach(async () => {
                await addLiquidityETH(expandTo18Decimals(10), expandTo18Decimals(80));
                await WETHPartner.approve(zap.address, MaxUint256);
            });

            it("zap in to left dust", async () => {
                let wethBalanceBefore = await WETH.balanceOf(zap.address);
                await getBalanceBefore(WETHPair);
                await zap.zapInToken(WETHPartner.address, [toWei(3), 0, 0], WETHPair.address, false);
                await zap.zapIn(WETHPair.address, 0, 0, false, {
                    ...overrides,
                    value: toWei(0.8),
                });

                // // fake send eth directly (should turn off restrict send eth)
                // await wallet.sendTransaction({to: zap.address, value: toWei(0.1)});

                let wethBalanceAfter = await WETH.balanceOf(zap.address);
                await getBalanceAfter(WETHPair);

                // expect(zapETHAfter).is.gt(zapETHBefore);
                expect(wethBalanceAfter).is.gt(wethBalanceBefore);
                expect(zapPartnerAfter).is.gt(zapPartnerBefore);
                expect(zapPairAfter).is.eq(zapPairBefore);

                await getBalanceBefore(WETHPair);
                wethBalanceBefore = await WETH.balanceOf(wallet.address);
                await zap.withdrawToken([WETH.address, WETHPartner.address, ADDRESS_ZERO], wallet.address);
                wethBalanceAfter = await WETH.balanceOf(wallet.address);
                await getBalanceAfter(WETHPair);

                // expect(ethBefore).is.lt(ethAfter);
                expect(ethPartnerBefore).is.lt(ethPartnerAfter);
                expect(wethBalanceBefore).is.lt(wethBalanceAfter);
                // expect(zapETHAfter).is.lt(zapETHBefore);
                expect(zapPartnerAfter).is.lt(zapPartnerBefore);
            });
        });
    });
});
