import {
	FireBirdFormula,
	FireBirdFormulaFactory,
	TestErc20Factory,

	RouterEventEmitterFactory,
	FireBirdErc20,
	FireBirdFactory,
	FireBirdFactoryFactory,
	FireBirdPair,
	FireBirdPairFactory,
	FireBirdRouterFactory,
	Weth9Factory,
	FireBirdRouter,
	Weth9,
	RouterEventEmitter,
	TToken,
	StakePoolCreator,
	StakePoolEpochRewardCreator,
	StakePoolController,
	FireBirdFactoryMock,
	TTokenFactory,
	StakePoolCreatorFactory,
	StakePoolEpochRewardCreatorFactory,
	StakePoolControllerFactory,
	FireBirdFactoryMockFactory,
	LpTokenFactory,
	SwapFactory,
	SwapUtils,
	MathUtilsFactory,
	StableSwapRouterFactory, SwapCreator, StableSwapFactory, LpToken, StableSwapRouter, Swap, StableSwapFactoryFactory,
} from "../../../typechain";
import {
	getAddress,
	keccak256
} from "ethers/lib/utils";
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import {toWei} from "./utilities";
import {Contract} from "ethers";
import {deployments} from 'hardhat';
import {deployContractWithLibraries} from "./common";
// @ts-ignore
import SwapUtilsArtifact from "../../../artifacts/contracts/stableSwap/SwapUtils.sol/SwapUtils.json";
// @ts-ignore
import SwapCreatorArtifact from "../../../artifacts/contracts/stableSwap/SwapCreator.sol/SwapCreator.json";

interface FormulaFixture {
	formula: FireBirdFormula
}

interface FactoryFixture {
	factory: FireBirdFactory
	formula: FireBirdFormula
}

const overrides = {}

export async function formulaFixture(signer: SignerWithAddress): Promise<FormulaFixture> {
	return await deployments.createFixture(async () => {
		const formula = await new FireBirdFormulaFactory(signer).deploy()
		return {formula}
	})()
}

export async function factoryFixture(signer: SignerWithAddress): Promise<FactoryFixture> {
	return await deployments.createFixture(async () => {

		const {formula} = await formulaFixture(signer)
		const factory = await new FireBirdFactoryFactory(signer).deploy(signer.address, formula.address)
		return {factory, formula}
	})()
}

interface PairFixture extends FactoryFixture {
	token0: FireBirdErc20
	tokenWeight0: number
	token1: FireBirdErc20
	tokenWeight1: number
	pair: FireBirdPair
	tokenA: FireBirdErc20
	tokenB: FireBirdErc20
}

export async function pairFixture(signer: SignerWithAddress): Promise<PairFixture> {
	return await deployments.createFixture(async () => {

		const {factory, formula} = await factoryFixture(signer)

		const tokenA = await new TestErc20Factory(signer).deploy(toWei(10000));
		const tokenB = await new TestErc20Factory(signer).deploy(toWei(10000))

		await factory.createPair(tokenA.address, tokenB.address, 50, 30, overrides)
		const pairAddress = await factory.getPair(tokenA.address, tokenB.address, 50, 30)
		const pair = FireBirdPairFactory.connect(pairAddress, signer)
		const token0Address = await pair.token0()
		const token0 = tokenA.address === token0Address ? tokenA : tokenB
		const token1 = tokenA.address === token0Address ? tokenB : tokenA
		const tokenWeight0 = 50;
		const tokenWeight1 = 50;
		return {factory, formula, token0, tokenWeight0, token1, tokenWeight1, pair, tokenA, tokenB}
	})();
}

export async function pairDifferentWeightFixture(signer: SignerWithAddress, tokenWeightA = 80): Promise<PairFixture> {
	return await deployments.createFixture(async () => {

		const {factory, formula} = await factoryFixture(signer)

		const tokenA = await new TestErc20Factory(signer).deploy(toWei(10000));
		const tokenB = await new TestErc20Factory(signer).deploy(toWei(10000))

		await factory.createPair(tokenA.address, tokenB.address, tokenWeightA, 40, overrides)
		const pairAddress = await factory.getPair(tokenA.address, tokenB.address, tokenWeightA, 40)
		const pair = FireBirdPairFactory.connect(pairAddress, signer)
		const token0Address = await pair.token0()
		const token1Address = await pair.token1()
		const {_tokenWeight0: tokenWeight0, _tokenWeight1: tokenWeight1} = await pair.getTokenWeights();
		return {
			factory, formula,
			token0: TestErc20Factory.connect(token0Address, signer),
			tokenWeight0,
			token1: TestErc20Factory.connect(token1Address, signer),
			tokenWeight1,
			pair,
			tokenA,
			tokenB
		}
	})();
}


export interface V2Fixture {
	formula: Contract
	token0: FireBirdErc20
	token1: FireBirdErc20
	tokenA: FireBirdErc20
	tokenB: FireBirdErc20
	tokenWeight0: number,
	WETH: Weth9
	WETHPartner: Contract
	// factoryV1: Contract
	factoryV2: FireBirdFactory
	routerEventEmitter: RouterEventEmitter
	router: FireBirdRouter
	pair: FireBirdPair
	WETHPair: FireBirdPair
	initCodeHash: string
}

export async function v2Fixture(signer: SignerWithAddress, samePairWeight: boolean): Promise<V2Fixture> {
	return await deployments.createFixture(async () => {
		const {
			factory,
			formula,
			token0,
			token1,
			pair,
			tokenA,
			tokenB,
			tokenWeight0,
		} = samePairWeight ? await pairFixture(signer) : await pairDifferentWeightFixture(signer);
		const WETHPartner = await new TestErc20Factory(signer).deploy(toWei(10000));
		const WETH = await new Weth9Factory(signer).deploy();


		// deploy V2
		const factoryV2 = factory
		const uniswapPairBytecode = new FireBirdPairFactory(signer).bytecode;
		const initCodeHash = keccak256(uniswapPairBytecode);
		// deploy routers

		const router = await new FireBirdRouterFactory(signer).deploy(factoryV2.address, WETH.address, overrides)

		if (samePairWeight) {
			await factoryV2.createPair(WETH.address, WETHPartner.address, 50, 30)
		} else {
			await factoryV2.createPair(WETH.address, WETHPartner.address, 80, 40)
		}
		const WETHPairAddress = samePairWeight
			? await factoryV2.getPair(WETH.address, WETHPartner.address, 50, 30)
			: await factoryV2.getPair(WETH.address, WETHPartner.address, 80, 40);
		const WETHPair = FireBirdPairFactory.connect(WETHPairAddress, signer)
		const routerEventEmitter = await new RouterEventEmitterFactory(signer).deploy()
		return {
			formula,
			token0,
			token1,
			tokenA,
			tokenB,
			tokenWeight0,
			WETH,
			WETHPartner,
			// factoryV1,
			factoryV2,
			router,
			routerEventEmitter,
			// migrator,
			// WETHExchangeV1,
			pair,
			WETHPair,
			initCodeHash
		}
	})()

}

interface StakePoolFixture {
	stakeToken: TToken,
	stakePoolCreator: StakePoolCreator,
	stakePoolEpochRewardCreator: StakePoolEpochRewardCreator,
	stakePoolController: StakePoolController,
	fireBirdFactoryMock: FireBirdFactoryMock,
}

export async function stakePoolFixture(signer: SignerWithAddress): Promise<StakePoolFixture> {
	return await deployments.createFixture(async () => {
		const stakeToken = await new TTokenFactory(signer).deploy("Test", "TEST", toWei(100000));
		const stakePoolCreator = await new StakePoolCreatorFactory(signer).deploy();
		const stakePoolEpochRewardCreator = await new StakePoolEpochRewardCreatorFactory(signer).deploy();
		const stakePoolController = await new StakePoolControllerFactory(signer).deploy();
		const fireBirdFactoryMock = await new FireBirdFactoryMockFactory(signer).deploy();
		await stakePoolController.initialize(fireBirdFactoryMock.address);
		return {
			stakeToken,
			stakePoolCreator,
			stakePoolEpochRewardCreator,
			stakePoolController,
			fireBirdFactoryMock,
		}
	})()
}

interface StableFixture {
	firstToken: Contract,
	secondToken: Contract,
	thirdToken: Contract,
	stableFactory: StableSwapFactory,
	swapToken: LpToken,
	linkSwapToken: LpToken,
	stableSwapRouter: StableSwapRouter,
	swap: Swap,
	linkSwap: Swap,
}

export async function stableFixture (signer: SignerWithAddress): Promise<StableFixture> {
	return await deployments.createFixture(async () => {
		// Deploy dummy tokens
		const firstToken = await new TestErc20Factory(signer).deploy(toWei(10000));
		const secondToken = await new TestErc20Factory(signer).deploy(toWei(10000));
		const thirdToken = await new TestErc20Factory(signer).deploy(toWei(10000));
		const stableSwapRouter = await new StableSwapRouterFactory(signer).deploy();

		// Deploy MathUtils
		const mathUtils = await new MathUtilsFactory(signer).deploy();

		// Deploy SwapUtils with MathUtils library
		const swapUtils = (await deployContractWithLibraries(signer, SwapUtilsArtifact, {
			MathUtils: mathUtils.address,
		})) as SwapUtils;
		await swapUtils.deployed();

		// Deploy Creator with SwapUtils library
		const stableCreator = (await deployContractWithLibraries(
			signer,
			SwapCreatorArtifact,
			{ SwapUtils: swapUtils.address },
			[],
		)) as SwapCreator;

		// Deploy Factory
		const stableFactory = await new StableSwapFactoryFactory(signer).deploy();
		await stableFactory.initialize(signer.address, stableCreator.address);

		const tx = await stableFactory.createPool(
			[firstToken.address, secondToken.address],
			[18, 18],
			"Saddle Stable1/Stable2",
			"saddleStable",
			200,
			1e8, // 1%
			5e9, // 50%
			5e7, // 0.5%
			24 * 3600,
		);
		const receipt = await tx.wait();
		const swapAddress = getAddress(receipt.logs[3].topics[1].slice(26)) ?? null;
		const swap = SwapFactory.connect(swapAddress, signer);

		const swapStorage = await swap.swapStorage();
		const swapToken = LpTokenFactory.connect(swapStorage.lpToken, signer);


		const linkTx = await stableFactory.createPool(
			[swapToken.address, thirdToken.address],
			[18, 18],
			"Link Saddle swapToken/thirdToken",
			"linkSaddleStable",
			200,
			1e8, // 1%
			5e9, // 50%
			5e7, // 0.5%
			24 * 3600,
		);
		const linkReceipt = await linkTx.wait();
		const linkSwapAddress = getAddress(linkReceipt.logs[3].topics[1].slice(26)) ?? null;
		const linkSwap = SwapFactory.connect(linkSwapAddress, signer);

		const linkSwapStorage = await linkSwap.swapStorage();
		const linkSwapToken = LpTokenFactory.connect(linkSwapStorage.lpToken, signer);

		return {
			firstToken,
			secondToken,
			thirdToken,
			stableFactory,
			swapToken,
			stableSwapRouter,
			swap,
			linkSwap,
			linkSwapToken,

		}
	})()
}