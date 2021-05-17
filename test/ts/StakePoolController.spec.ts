import {expect} from "./chai-setup";
import {ethers} from "hardhat";


import {stakePoolFixture} from './shared/fixtures'
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import {
	ADDRESS_ZERO,
	getLatestBlockNumber,
	maxUint256,
	toWei
} from "./shared/utilities";
import {
	StakePoolController,
	StakePoolCreator, SimpleEpochControllerFactory, TToken, TTokenFactory
} from "../../typechain";
import {ParamType} from "@ethersproject/abi/src.ts/fragments";
import {encodeEpochPoolInfo} from "./StakePoolEpochReward.spec";

const overrides = {};

function encodeParameters(types: Array<string | ParamType>, values: Array<any>) {
	const abi = new ethers.utils.AbiCoder();
	return abi.encode(types, values);
}

export function encodePoolInfo(data: any) {
	return encodeParameters(['address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'], [
		data.rewardRebaser,
		data.rewardMultiplier,
		data.startBlock,
		data.endRewardBlock,
		data.rewardPerBlock,
		data.lockRewardPercent,
		data.startVestingBlock,
		data.endVestingBlock,
		data.unstakingFrozenTime,
	])
}

describe('StakePoolController', () => {
	let signers: SignerWithAddress[];
	let wallet: SignerWithAddress;
	let other: SignerWithAddress;
	let version: any;
	let stakePoolCreator: StakePoolCreator
	let stakePoolController: StakePoolController
	let rewardToken1: TToken;
	let rewardToken2: TToken;
	let pair: TToken;
	beforeEach(async () => {
		signers = await ethers.getSigners();
		wallet = signers[0];
		other = signers[1];
		const fixture = await stakePoolFixture(wallet)
		stakePoolController = fixture.stakePoolController;
		stakePoolCreator = fixture.stakePoolCreator;
		rewardToken1 = await new TTokenFactory(wallet).deploy("TEST1", "TEST1",toWei(10000));
		rewardToken2 = await new TTokenFactory(wallet).deploy("TEST2", "TEST2", toWei(10000));
		pair = fixture.stakeToken;
		version = await stakePoolCreator.version();
		await stakePoolController.addStakePoolCreator(stakePoolCreator.address);
		await stakePoolController.addStakePoolCreator(fixture.stakePoolEpochRewardCreator.address);

	})


	it('setGovernance', async () => {
		await expect(stakePoolController.connect(wallet).setGovernance(ADDRESS_ZERO)).to.be.revertedWith("StakePoolController: invalid governance");
		await expect(stakePoolController.connect(other).setGovernance(other.address)).to.be.revertedWith("StakePoolController: !governance");
		await stakePoolController.connect(wallet).setGovernance(other.address);
		await stakePoolController.connect(other).setGovernance(wallet.address);
	})
	it('whitelistRewardMultiplier', async () => {
		await expect(stakePoolController.connect(wallet).setWhitelistRewardMultiplier(ADDRESS_ZERO, true)).to.be.revertedWith("StakePoolController: invalid address");
		await expect(stakePoolController.connect(other).setWhitelistRewardMultiplier(other.address, true)).to.be.revertedWith("StakePoolController: !governance");
		expect(await stakePoolController.connect(wallet).isWhitelistRewardMultiplier(other.address)).to.eq(false);
		await stakePoolController.connect(wallet).setWhitelistRewardMultiplier(other.address, true);
		expect(await stakePoolController.connect(wallet).isWhitelistRewardMultiplier(other.address)).to.eq(true);
		await stakePoolController.connect(wallet).setWhitelistRewardMultiplier(other.address, false)
		expect(await stakePoolController.connect(wallet).isWhitelistRewardMultiplier(other.address)).to.eq(false);
	})
	it('whitelistRewardRebaser', async () => {
		await expect(stakePoolController.connect(wallet).setWhitelistRewardRebaser(ADDRESS_ZERO, true)).to.be.revertedWith("StakePoolController: invalid address");
		await expect(stakePoolController.connect(other).setWhitelistRewardRebaser(other.address, true)).to.be.revertedWith("StakePoolController: !governance");
		expect(await stakePoolController.connect(wallet).isWhitelistRewardRebaser(other.address)).to.eq(false);
		await stakePoolController.connect(wallet).setWhitelistRewardRebaser(other.address, true);
		expect(await stakePoolController.connect(wallet).isWhitelistRewardRebaser(other.address)).to.eq(true);
		await stakePoolController.connect(wallet).setWhitelistRewardRebaser(other.address, false)
		expect(await stakePoolController.connect(wallet).isWhitelistRewardRebaser(other.address)).to.eq(false);
	})

	it('whitelistStakingFor', async () => {
		await expect(stakePoolController.connect(wallet).setWhitelistStakingFor(ADDRESS_ZERO, true)).to.be.revertedWith("StakePoolController: invalid address");
		await expect(stakePoolController.connect(other).setWhitelistStakingFor(other.address, true)).to.be.revertedWith("StakePoolController: !governance");
		expect(await stakePoolController.connect(wallet).isWhitelistStakingFor(other.address)).to.eq(false);
		await stakePoolController.connect(wallet).setWhitelistStakingFor(other.address, true);
		expect(await stakePoolController.connect(wallet).isWhitelistStakingFor(other.address)).to.eq(true);
		await stakePoolController.connect(wallet).setWhitelistStakingFor(other.address, false)
		expect(await stakePoolController.connect(wallet).isWhitelistStakingFor(other.address)).to.eq(false);
	})
	it('create invalid version', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await expect(stakePoolController.connect(other).create(1, pair.address, rewardToken1.address, 0, 3600 * 48, encodePoolInfo({
			rewardToken: rewardToken1.address,
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 0,
			startVestingBlock: 0,
			endVestingBlock: 0,
			unstakingFrozenTime: 0,
		}))).to.be.revertedWith("StakePoolController: Invalid stake pool creator version");

	})
	it('create invalid lockRewardPercent', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await expect(stakePoolController.connect(other).create(version, pair.address, rewardToken1.address, 0, 3600 * 48, encodePoolInfo({
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 101,
			startVestingBlock: 0,
			endVestingBlock: 0,
			unstakingFrozenTime: 0,
		}))).to.be.revertedWith("StakePool: invalid lockRewardPercent");
	})
	it('create invalid rewardToken balance', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await expect(stakePoolController.connect(other).create(version, pair.address, rewardToken1.address, 1000000, 3600 * 48, encodePoolInfo({
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 50,
			startVestingBlock: latestBlockNumber + 100,
			endVestingBlock: latestBlockNumber + 101,
			unstakingFrozenTime: 0,
		}))).to.be.revertedWith("StakePoolController: Not enough rewardFundAmount");
	})
	it('create invalid endVestingBlock', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await rewardToken1.approve(stakePoolController.address, maxUint256);
		await expect(stakePoolController.connect(wallet).create(version, pair.address, rewardToken1.address, 10, 3600 * 48, encodePoolInfo({
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 50,
			startVestingBlock: latestBlockNumber + 101,
			endVestingBlock: latestBlockNumber + 100,
			unstakingFrozenTime: 0,
		}))).to.be.revertedWith("StakePool: startVestingBlock > endVestingBlock");
	})
	it('create invalid rewardRebaser', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await rewardToken1.approve(stakePoolController.address, maxUint256);
		let poolRewardInfo = encodePoolInfo({
			rewardRebaser: wallet.address,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 50,
			startVestingBlock: latestBlockNumber + 100,
			endVestingBlock: latestBlockNumber + 101,
			unstakingFrozenTime: 0,
		});
		await expect(stakePoolController.connect(wallet).create(version, pair.address, rewardToken1.address, 10, 3600 * 48, poolRewardInfo)).to.be.revertedWith("StakePool: Invalid reward rebaser");
		await stakePoolController.setWhitelistRewardRebaser(wallet.address, true);
		await stakePoolController.connect(wallet).create(version, pair.address, rewardToken1.address, 10, 3600 * 48, poolRewardInfo);

	})
	it('create invalid delayTimeLock', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await rewardToken1.approve(stakePoolController.address, maxUint256);
		let poolRewardInfo = encodePoolInfo({
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 50,
			startVestingBlock: latestBlockNumber + 100,
			endVestingBlock: latestBlockNumber + 101,
			unstakingFrozenTime: 0,
		});
		await expect(stakePoolController.connect(wallet).create(version, pair.address, rewardToken1.address, 10, 3600, poolRewardInfo)).to.be.revertedWith("Timelock::setDelay: Delay must exceed minimum delay.");
		await stakePoolController.setWhitelistRewardRebaser(wallet.address, true);
		await stakePoolController.connect(wallet).create(version, pair.address, rewardToken1.address, 10, 3600 * 48, poolRewardInfo);

	})
	it('create invalid rewardMultiplier', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await rewardToken1.approve(stakePoolController.address, maxUint256);
		let poolRewardInfo = encodePoolInfo({
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: wallet.address,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 50,
			startVestingBlock: latestBlockNumber + 100,
			endVestingBlock: latestBlockNumber + 101,
			unstakingFrozenTime: 0,
		});
		await expect(stakePoolController.connect(wallet).create(version, pair.address, rewardToken1.address, 10, 3600 * 48, poolRewardInfo)).to.be.revertedWith("StakePool: Invalid reward multiplier");
		await stakePoolController.setWhitelistRewardMultiplier(wallet.address, true);
		await stakePoolController.connect(wallet).create(version, pair.address, rewardToken1.address, 10, 3600 * 48, poolRewardInfo);
	})
	it('create valid pool', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await rewardToken1.approve(stakePoolController.address, maxUint256);
		let poolRewardInfo = encodePoolInfo({
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 50,
			startVestingBlock: latestBlockNumber + 100,
			endVestingBlock: latestBlockNumber + 101,
			unstakingFrozenTime: 0,
		});
		await expect(stakePoolController.connect(wallet).create(version, pair.address, rewardToken1.address, 10, 3600 * 48, poolRewardInfo))
			.to.emit(stakePoolController, 'MasterCreated');


	})
	it('create valid pool pay fee', async () => {
		const feeToken = await new TTokenFactory(wallet).deploy("FeeToken", "FEE", toWei(10000));
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await rewardToken1.approve(stakePoolController.address, maxUint256);
		await stakePoolController.setFeeAmount(toWei(1))
		await stakePoolController.setFeeCollector(other.address)
		await stakePoolController.setFeeToken(feeToken.address);
		await stakePoolController.setExtraFeeRate(1000);
		await feeToken.approve(stakePoolController.address, toWei(1))
		let poolRewardInfo = encodePoolInfo({
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 50,
			startVestingBlock: latestBlockNumber + 100,
			endVestingBlock: latestBlockNumber + 101,
			unstakingFrozenTime: 0,
		});
		await expect(() => stakePoolController.connect(wallet).create(version, pair.address, rewardToken1.address, 10, 3600 * 48, poolRewardInfo))
			.to.changeTokenBalance(feeToken, other, toWei(1));
	})

	it('create valid SimpleEpochController', async () => {
		await rewardToken1.approve(stakePoolController.address, maxUint256);
		const epochController = await new SimpleEpochControllerFactory(wallet).deploy();
		let poolRewardInfo = encodeEpochPoolInfo({
			epochController: epochController.address,
			withdrawLockupEpochs: 2,
			rewardLockupEpochs: 1,

		});
		await stakePoolController.connect(wallet).create(4001, pair.address, rewardToken1.address, 10, 3600 * 48, poolRewardInfo);
	})
})
