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
	Weth9, RouterEventEmitter,
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
