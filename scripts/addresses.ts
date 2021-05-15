import {deployments, ethers} from 'hardhat';
async function main() {
	let contracts = await deployments.all();
	for (let name in contracts) {
		console.log(name + " " + contracts[name].address)
	}
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});