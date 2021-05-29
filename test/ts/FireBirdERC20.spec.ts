import {expect} from "./chai-setup";
import {BigNumber, Contract} from 'ethers'
import { ecsign } from 'ethereumjs-util'

import {
	keccak256,
	defaultAbiCoder,
	toUtf8Bytes,
	hexlify
} from 'ethers/lib/utils'
import {ethers,network} from "hardhat";



import {getApprovalDigest} from './shared/common'
import {maxUint256, toWei} from './shared/utilities'
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import {FireBirdErc20WrapperFactory} from "../../typechain";


const TOTAL_SUPPLY = toWei(10000)
const TEST_AMOUNT = toWei(10)

describe('FireBirdErc20', () => {
	let signers: SignerWithAddress[];

	let wallet: SignerWithAddress;
	let other: SignerWithAddress;
	let deployWallet: any;

	let token: Contract
	beforeEach(async () => {
		deployWallet = await ethers.Wallet.fromMnemonic(((network.config.accounts) as any).mnemonic);
		signers = await ethers.getSigners();
		wallet = signers[0];
		other = signers[1];
		token = await new FireBirdErc20WrapperFactory(wallet).deploy(TOTAL_SUPPLY)
	})

	it('name, symbol, decimals, totalSupply, balanceOf, DOMAIN_SEPARATOR, PERMIT_TYPEHASH', async () => {
		const name = await token.name()
		expect(name).to.eq('FireBird Liquidity Provider')
		expect(await token.symbol()).to.eq('FLP')
		expect(await token.decimals()).to.eq(18)
		expect(await token.totalSupply()).to.eq(TOTAL_SUPPLY)
		expect(await token.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY)
		expect(await token.DOMAIN_SEPARATOR()).to.eq(
			keccak256(
				defaultAbiCoder.encode(
					['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
					[
						keccak256(
							toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
						),
						keccak256(toUtf8Bytes(name)),
						keccak256(toUtf8Bytes('1')),
						1,
						token.address
					]
				)
			)
		)
		expect(await token.PERMIT_TYPEHASH()).to.eq(
			keccak256(toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)'))
		)
	})

	it('approve', async () => {
		await expect(token.approve(other.address, TEST_AMOUNT))
			.to.emit(token, 'Approval')
			.withArgs(wallet.address, other.address, TEST_AMOUNT)
		expect(await token.allowance(wallet.address, other.address)).to.eq(TEST_AMOUNT)
	})

	it('transfer', async () => {
		await expect(token.transfer(other.address, TEST_AMOUNT))
			.to.emit(token, 'Transfer')
			.withArgs(wallet.address, other.address, TEST_AMOUNT)
		expect(await token.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT))
		expect(await token.balanceOf(other.address)).to.eq(TEST_AMOUNT)
	})

	it('transfer:fail', async () => {
		await expect(token.transfer(other.address, TOTAL_SUPPLY.add(1))).to.be.reverted // ds-math-sub-underflow
		await expect(token.connect(other).transfer(wallet.address, 1)).to.be.reverted // ds-math-sub-underflow
	})

	it('transferFrom', async () => {
		await token.approve(other.address, TEST_AMOUNT)
		await expect(token.connect(other).transferFrom(wallet.address, other.address, TEST_AMOUNT))
			.to.emit(token, 'Transfer')
			.withArgs(wallet.address, other.address, TEST_AMOUNT)
		expect(await token.allowance(wallet.address, other.address)).to.eq(0)
		expect(await token.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT))
		expect(await token.balanceOf(other.address)).to.eq(TEST_AMOUNT)
	})

	it('transferFrom:max', async () => {
		await token.approve(other.address, maxUint256)
		await expect(token.connect(other).transferFrom(wallet.address, other.address, TEST_AMOUNT))
			.to.emit(token, 'Transfer')
			.withArgs(wallet.address, other.address, TEST_AMOUNT)
		expect(await token.allowance(wallet.address, other.address)).to.eq(maxUint256)
		expect(await token.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT))
		expect(await token.balanceOf(other.address)).to.eq(TEST_AMOUNT)
	})

	it('permit', async () => {
		const nonce = await token.nonces(wallet.address)
		const deadline = maxUint256
		const digest = await getApprovalDigest(
			token,
			{owner: wallet.address, spender: other.address, value: TEST_AMOUNT},
			nonce,
			deadline
		)
		const {v, r, s} = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(deployWallet.privateKey.slice(2), 'hex'))

		await expect(token.permit(wallet.address, other.address, TEST_AMOUNT, deadline, v, hexlify(r), hexlify(s)))
			.to.emit(token, 'Approval')
			.withArgs(wallet.address, other.address, TEST_AMOUNT)
		expect(await token.allowance(wallet.address, other.address)).to.eq(TEST_AMOUNT)
		expect(await token.nonces(wallet.address)).to.eq(BigNumber.from(1))
	})
})
