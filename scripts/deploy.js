const { ethers, upgrades } = require("hardhat");
const { BigNumber } = require("@ethersproject/bignumber");
const verifyStr = "npx hardhat verify --network";

let signer = "0xA96f026F9A232E556F306D2B27677133B4dAe7Ff";

const configAddress = "";
const factoryAddress = "";
const stakingFactoryAddress = "";
const baseAddress = "";
const quoteAddress = "";
const routerAddress = "";
const priceOracleTestAddress = "";
let ammAddress = "";
let marginAddress = "";

const deadline = 1953397680;
const long = 0;
const short = 1;

let l2Config;
let l2BaseToken;
let l2QuoteToken;
let l2Weth;
let l2Factory;
let l2StakingFactory;
let l2Router;
let priceOracleForTest;
let l2Amm;
let l2Margin;

let tx;
let positionItem;
const main = async () => {
  await createContracts();
};

async function createContracts() {
  const Config = await ethers.getContractFactory("Config");
  const MockToken = await ethers.getContractFactory("MockToken");
  const L2Factory = await ethers.getContractFactory("PairFactory");
  const L2StakingFactory = await ethers.getContractFactory("StakingFactory");
  const L2Router = await ethers.getContractFactory("Router");
  const PriceOracleForTest = await ethers.getContractFactory("PriceOracleForTest");
  const L2Amm = await ethers.getContractFactory("Amm");
  const L2Margin = await ethers.getContractFactory("Margin");

  // //new config
  l2Config = await upgrades.deployProxy(Config, [signer, 100]);
  await l2Config.deployed();
  console.log("l2Config address: ", l2Config.address);
  //new mockToken base and quote
  l2BaseToken = await MockToken.deploy("base token", "bt");
  await l2BaseToken.deployed();
  console.log(`l2BaseToken: ${l2BaseToken.address}`);
  l2QuoteToken = await MockToken.deploy("quote token", "qt");
  await l2QuoteToken.deployed();
  console.log(`l2QuoteToken: ${l2QuoteToken.address}`);
  l2Weth = await MockToken.deploy("weth token", "wt");
  await l2Weth.deployed();
  console.log(`l2Weth: ${l2Weth.address}`);
  //new factory
  l2Factory = await L2Factory.deploy(l2Config.address);
  await l2Factory.deployed();
  console.log(`l2Factory: ${l2Factory.address}`);
  //new staking factory
  l2StakingFactory = await L2StakingFactory.deploy(l2Config.address, l2Factory.address);
  await l2StakingFactory.deployed();
  console.log(`l2StakingFactory: ${l2StakingFactory.address}`);
  //new router
  l2Router = await L2Router.deploy(l2Factory.address, l2StakingFactory.address, l2Weth.address);
  await l2Router.deployed();
  console.log(`l2Router: ${l2Router.address}`);
  //new PriceOracleForTest
  priceOracleForTest = await PriceOracleForTest.deploy();
  await priceOracleForTest.deployed();
  console.log(`priceOracleForTest: ${priceOracleForTest.address}`);

  //init set
  tx = await l2Config.setPriceOracle(priceOracleForTest.address);
  await tx.wait();
  tx = await l2Config.setInitMarginRatio(800);
  await tx.wait();
  tx = await l2Config.setLiquidateThreshold(10000);
  await tx.wait();
  tx = await l2Config.setLiquidateFeeRatio(100);
  await tx.wait();
  tx = await l2Config.setRebasePriceGap(1);
  await tx.wait();
  tx = await priceOracleForTest.setReserve(l2BaseToken.address, l2QuoteToken.address, 1, 2000);
  await tx.wait();
  tx = await l2BaseToken.mint(signer, ethers.utils.parseEther("10000000000000.0"));
  await tx.wait();
  tx = await l2QuoteToken.mint(signer, ethers.utils.parseEther("20000000000000.0"));
  await tx.wait();
  tx = await l2BaseToken.approve(l2Router.address, ethers.constants.MaxUint256);
  await tx.wait();
  tx = await l2Router.addLiquidity(
    l2BaseToken.address,
    l2QuoteToken.address,
    ethers.utils.parseEther("100000000.0"),
    0,
    deadline,
    false
  );
  await tx.wait();

  ammAddress = await l2Factory.getAmm(l2BaseToken.address, l2QuoteToken.address);
  marginAddress = await l2Factory.getMargin(l2BaseToken.address, l2QuoteToken.address);

  l2Amm = await L2Amm.attach(ammAddress); //exist amm address
  l2Margin = await L2Margin.attach(marginAddress); //exist margin address

  console.log("ammAddress: ", ammAddress);
  console.log("marginAddress: ", marginAddress);
  console.log("✌️");
  console.log(verifyStr, process.env.HARDHAT_NETWORK, l2Config.address);
  console.log(verifyStr, process.env.HARDHAT_NETWORK, l2Factory.address, l2Config.address);
  console.log(verifyStr, process.env.HARDHAT_NETWORK, l2StakingFactory.address, l2Config.address, l2Factory.address);
  console.log(
    verifyStr,
    process.env.HARDHAT_NETWORK,
    l2Router.address,
    l2Factory.address,
    l2StakingFactory.address,
    l2Weth.address
  );
  console.log(verifyStr, process.env.HARDHAT_NETWORK, l2BaseToken.address, "'base token' 'bt'");
  console.log(verifyStr, process.env.HARDHAT_NETWORK, l2QuoteToken.address, "'quote token' 'qt'");
  console.log(verifyStr, process.env.HARDHAT_NETWORK, l2Weth.address, "'weth token' 'wt'");
  console.log(verifyStr, process.env.HARDHAT_NETWORK, priceOracleForTest.address);

  await flowVerify(false);
}

async function flowVerify(needAttach) {
  //attach
  if (needAttach) {
    const L2Config = await ethers.getContractFactory("Config");
    const MockToken = await ethers.getContractFactory("MockToken");
    const L2Factory = await ethers.getContractFactory("PairFactory");
    const L2StakingFactory = await ethers.getContractFactory("StakingFactory");
    const L2Router = await ethers.getContractFactory("Router");
    const PriceOracleForTest = await ethers.getContractFactory("PriceOracleForTest");
    const L2Amm = await ethers.getContractFactory("Amm");
    const L2Margin = await ethers.getContractFactory("Margin");

    l2Config = await L2Config.attach(configAddress); //exist config address
    l2Factory = await L2Factory.attach(factoryAddress); //exist factory address
    l2StakingFactory = await L2StakingFactory.attach(stakingFactoryAddress);
    l2Router = await L2Router.attach(routerAddress); //exist router address
    l2BaseToken = await MockToken.attach(baseAddress); //exist base address
    l2QuoteToken = await MockToken.attach(quoteAddress); //exist quote address
    priceOracleForTest = await PriceOracleForTest.attach(priceOracleTestAddress); //exist priceOracleTest address
    l2Amm = await L2Amm.attach(ammAddress); //exist amm address
    l2Margin = await L2Margin.attach(marginAddress); //exist margin address
  }

  //flow 1: open position with margin
  console.log("deposit...");
  tx = await l2Router.deposit(l2BaseToken.address, l2QuoteToken.address, signer, ethers.utils.parseEther("1.0"));
  await tx.wait();

  console.log("open position with margin...");
  tx = await l2Router.openPositionWithMargin(
    l2BaseToken.address,
    l2QuoteToken.address,
    long,
    ethers.utils.parseEther("20000.0"),
    0,
    deadline
  );
  await tx.wait();
  positionItem = await l2Router.getPosition(l2BaseToken.address, l2QuoteToken.address, signer);
  printPosition(positionItem);
  console.log("close position...");
  tx = await l2Router.closePosition(
    l2BaseToken.address,
    l2QuoteToken.address,
    BigNumber.from(positionItem[1]).abs(),
    deadline,
    false
  );
  await tx.wait();
  positionItem = await l2Router.getPosition(l2BaseToken.address, l2QuoteToken.address, signer);
  printPosition(positionItem);

  console.log("withdraw...");
  tx = await l2Router.withdraw(l2BaseToken.address, l2QuoteToken.address, BigNumber.from(positionItem[0]).abs());
  await tx.wait();

  //flow 2: open position with wallet
  console.log("open position with wallet...");
  tx = await l2Router.openPositionWithWallet(
    l2BaseToken.address,
    l2QuoteToken.address,
    long,
    ethers.utils.parseEther("1.0"),
    ethers.utils.parseEther("20000.0"),
    0,
    deadline
  );
  await tx.wait();
  positionItem = await l2Router.getPosition(l2BaseToken.address, l2QuoteToken.address, signer);
  printPosition(positionItem);

  console.log("close position...");
  tx = await l2Router.closePosition(
    l2BaseToken.address,
    l2QuoteToken.address,
    BigNumber.from(positionItem[1]).abs(),
    deadline,
    false
  );
  await tx.wait();
  positionItem = await l2Router.getPosition(l2BaseToken.address, l2QuoteToken.address, signer);
  printPosition(positionItem);

  console.log("open short position with wallet...");
  tx = await l2Router.openPositionWithWallet(
    l2BaseToken.address,
    l2QuoteToken.address,
    short,
    ethers.utils.parseEther("1.0"),
    ethers.utils.parseEther("20000.0"),
    "999999999999999999999999999999",
    deadline
  );
  await tx.wait();
  positionItem = await l2Router.getPosition(l2BaseToken.address, l2QuoteToken.address, signer);
  printPosition(positionItem);

  console.log("close position...");
  tx = await l2Router.closePosition(
    l2BaseToken.address,
    l2QuoteToken.address,
    BigNumber.from(positionItem[1]).abs(),
    deadline,
    true
  );
  await tx.wait();
  positionItem = await l2Router.getPosition(l2BaseToken.address, l2QuoteToken.address, signer);
  printPosition(positionItem);

  //flow 3: liquidate
  console.log("open position with wallet...");
  tx = await l2Router.openPositionWithWallet(
    l2BaseToken.address,
    l2QuoteToken.address,
    long,
    ethers.utils.parseEther("1.0"),
    ethers.utils.parseEther("20000.0"),
    0,
    deadline
  );
  await tx.wait();
  positionItem = await l2Router.getPosition(l2BaseToken.address, l2QuoteToken.address, signer);
  printPosition(positionItem);

  let withdrawable = await l2Margin.getWithdrawable(signer);
  tx = await l2Router.withdraw(l2BaseToken.address, l2QuoteToken.address, BigNumber.from(withdrawable).abs());
  await tx.wait();

  console.log("set price...");
  tx = await priceOracleForTest.setReserve(l2BaseToken.address, l2QuoteToken.address, 1, 400);
  await tx.wait();
  console.log("rebase...");
  tx = await l2Amm.rebase();
  await tx.wait();

  console.log("liquidate position...");
  tx = await l2Margin.liquidate(signer);
  await tx.wait();
  positionItem = await l2Router.getPosition(l2BaseToken.address, l2QuoteToken.address, signer);
  printPosition(positionItem);

  //flow 4: close liquidatable position
  console.log("set price...");
  tx = await priceOracleForTest.setReserve(l2BaseToken.address, l2QuoteToken.address, 1, 400);
  await tx.wait();
  console.log("rebase...");
  tx = await l2Amm.rebase();
  await tx.wait();

  console.log("open short position with wallet...");
  tx = await l2Router.openPositionWithWallet(
    l2BaseToken.address,
    l2QuoteToken.address,
    short,
    ethers.utils.parseEther("1.0"),
    ethers.utils.parseEther("4000.0"),
    "999999999999999999999999999999",
    deadline
  );
  await tx.wait();
  positionItem = await l2Router.getPosition(l2BaseToken.address, l2QuoteToken.address, signer);
  printPosition(positionItem);

  withdrawable = await l2Margin.getWithdrawable(signer);
  tx = await l2Router.withdraw(l2BaseToken.address, l2QuoteToken.address, BigNumber.from(withdrawable).abs());
  await tx.wait();

  console.log("set price...");
  tx = await priceOracleForTest.setReserve(l2BaseToken.address, l2QuoteToken.address, 1, 2000);
  await tx.wait();
  console.log("rebase...");
  tx = await l2Amm.rebase();
  await tx.wait();

  positionItem = await l2Router.getPosition(l2BaseToken.address, l2QuoteToken.address, signer);
  printPosition(positionItem);
  console.log("close liquidatable position...");
  tx = await l2Router.closePosition(
    l2BaseToken.address,
    l2QuoteToken.address,
    BigNumber.from(positionItem[1]).abs(),
    deadline,
    false
  );
  await tx.wait();
  positionItem = await l2Router.getPosition(l2BaseToken.address, l2QuoteToken.address, signer);
  printPosition(positionItem);
}

function printPosition(positionItem) {
  console.log(
    "after open, current baseSize and quoteSize and tradeSize abs: ",
    BigNumber.from(positionItem[0]).toString(),
    BigNumber.from(positionItem[1]).toString(),
    BigNumber.from(positionItem[2]).toString()
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });