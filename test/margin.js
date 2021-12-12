const { expect } = require("chai");

describe("Margin contract", function () {
  let margin;
  let owner;
  let addr1;
  let liquidator;
  let addrs;
  let mockAmm;
  let mockBaseToken;
  let ownerInitBaseAmount = 20000;
  let addr1InitBaseAmount = 100;
  let routerAllowance = 10000;
  let longSide = 0;
  let shortSide = 1;
  let config;
  let mockPriceOracle;

  beforeEach(async function () {
    [owner, addr1, liquidator, ...addrs] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockToken");
    mockBaseToken = await MockToken.deploy("bit dao", "bit");
    mockQuoteToken = await MockToken.deploy("usdt dao", "usdt");

    const MockAmm = await ethers.getContractFactory("MockAmm");
    mockAmm = await MockAmm.deploy("amm shares", "as");

    const MockRouter = await ethers.getContractFactory("MockRouter");
    mockRouter = await MockRouter.deploy(mockBaseToken.address);

    const Config = await ethers.getContractFactory("Config");
    config = await Config.deploy();

    const Factory = await ethers.getContractFactory("MockFactory");
    factory = await Factory.deploy(config.address);
    await factory.createPair();

    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    mockPriceOracle = await MockPriceOracle.deploy();

    let marginAddress = await factory.margin();
    const Margin = await ethers.getContractFactory("Margin");
    margin = await Margin.attach(marginAddress);

    await config.initialize(owner.address);
    await factory.initialize(mockBaseToken.address, mockQuoteToken.address, mockAmm.address);
    await mockRouter.setMarginContract(margin.address);
    await mockAmm.initialize(mockBaseToken.address, mockQuoteToken.address);

    await mockBaseToken.mint(owner.address, ownerInitBaseAmount);
    await mockBaseToken.mint(addr1.address, addr1InitBaseAmount);
    await mockBaseToken.approve(mockRouter.address, routerAllowance);
    await mockBaseToken.connect(addr1).approve(mockRouter.address, addr1InitBaseAmount);

    await config.registerRouter(mockRouter.address);
    await config.setBeta(100);
    await config.setInitMarginRatio(909);
    await config.setLiquidateThreshold(10000);
    await config.setLiquidateFeeRatio(2000);
    await config.setPriceOracle(mockPriceOracle.address);
  });

  describe("addMargin", function () {
    it("revert when no enough allowance by router", async function () {
      await expect(mockRouter.addMargin(addr1.address, routerAllowance + 1)).to.be.revertedWith(
        "ERC20: transfer amount exceeds allowance"
      );
    });

    it("add correct margin from router", async function () {
      await mockRouter.addMargin(addr1.address, routerAllowance);
      let position = await margin.traderPositionMap(addr1.address);
      expect(position[1]).to.equal(routerAllowance);
    });

    it("margin remain baseToken, trader profit it through margin.sol", async function () {
      await mockBaseToken.connect(addr1).transfer(margin.address, addr1InitBaseAmount);
      await margin.addMargin(owner.address, addr1InitBaseAmount);
      let position = await margin.traderPositionMap(owner.address);
      expect(position[1]).to.equal(addr1InitBaseAmount);
    });

    it("add wrong margin", async function () {
      await expect(margin.addMargin(addr1.address, -10)).to.be.reverted;
      await expect(margin.addMargin(addr1.address, 10)).to.be.revertedWith("Margin.addMargin: WRONG_DEPOSIT_AMOUNT");
    });

    describe("operate margin with old position", function () {
      beforeEach(async function () {
        let quoteAmount = 10;

        await mockRouter.addMargin(owner.address, 1);
        await margin.openPosition(owner.address, longSide, quoteAmount);
        let position = await margin.traderPositionMap(owner.address);
        expect(position[0]).to.equal(-10);
        expect(position[1]).to.equal(11);
        expect(position[2]).to.equal(10);
      });

      it("add an old position", async function () {
        await mockRouter.addMargin(owner.address, 2);
        let position = await margin.traderPositionMap(owner.address);
        expect(position[0]).to.equal(-10);
        expect(position[1]).to.equal(13);
        expect(position[2]).to.equal(10);
      });
    });
  });

  describe("remove margin", async function () {
    beforeEach(async function () {
      await mockRouter.addMargin(owner.address, routerAllowance);
    });

    it("remove correct margin", async function () {
      await margin.removeMargin(owner.address, routerAllowance);
      expect(await mockBaseToken.balanceOf(owner.address)).to.equal(ownerInitBaseAmount);
    });

    it("no position, have baseToken, remove wrong margin", async function () {
      await expect(margin.removeMargin(owner.address, 0)).to.be.revertedWith(
        "Margin.removeMargin: ZERO_WITHDRAW_AMOUNT"
      );
      await expect(margin.removeMargin(owner.address, routerAllowance + 1)).to.be.revertedWith(
        "Margin.removeMargin: NOT_ENOUGH_WITHDRAWABLE"
      );
    });

    it("no position and no baseToken, remove margin", async function () {
      let withdrawable = (await margin.getWithdrawable(owner.address)).toNumber();
      expect(withdrawable).to.be.equal(routerAllowance);
      await margin.removeMargin(owner.address, routerAllowance);
      await expect(margin.removeMargin(owner.address, 1)).to.be.revertedWith(
        "Margin.removeMargin: NOT_ENOUGH_WITHDRAWABLE"
      );
    });

    describe("remove margin with old position", function () {
      beforeEach(async function () {
        let quoteAmount = 10;
        await margin.openPosition(owner.address, longSide, quoteAmount);
        let position = await margin.traderPositionMap(owner.address);
        expect(position[0]).to.equal(-10);
        expect(position[1]).to.equal(routerAllowance + 10);
        expect(position[2]).to.equal(10);

        await mockRouter.connect(addr1).addMargin(addr1.address, addr1InitBaseAmount);
        await margin.connect(addr1).openPosition(addr1.address, shortSide, quoteAmount);
        position = await margin.traderPositionMap(addr1.address);
        expect(position[0]).to.equal(10);
        expect(position[1]).to.equal(addr1InitBaseAmount - 10);
        expect(position[2]).to.equal(10);
      });

      it("withdraw maximum margin from an old short position", async function () {
        await margin.connect(addr1).openPosition(addr1.address, shortSide, 5);
        position = await margin.traderPositionMap(addr1.address);
        expect(position[0]).to.equal(15);
        expect(position[1]).to.equal(85);
        expect(position[2]).to.equal(15);

        await expect(mockRouter.connect(addr1).removeMargin(addr1InitBaseAmount - 1)).to.be.revertedWith(
          "Margin.removeMargin: NOT_ENOUGH_WITHDRAWABLE"
        );
        expect(await margin.getWithdrawable(addr1.address)).to.be.equal(addr1InitBaseAmount - 2);
        await mockRouter.connect(addr1).removeMargin(addr1InitBaseAmount - 2);
        position = await margin.traderPositionMap(addr1.address);
        expect(position[0]).to.equal(15);
        expect(position[1]).to.equal(-13);
        expect(position[2]).to.equal(15);
      });

      it("withdraw maximum margin from an old short position", async function () {
        await expect(mockRouter.connect(addr1).removeMargin(addr1InitBaseAmount)).to.be.revertedWith(
          "Margin.removeMargin: NOT_ENOUGH_WITHDRAWABLE"
        );
        expect(await margin.getWithdrawable(addr1.address)).to.be.equal(addr1InitBaseAmount - 1);
        await mockRouter.connect(addr1).removeMargin(addr1InitBaseAmount - 1);
        position = await margin.traderPositionMap(addr1.address);
        expect(position[0]).to.equal(10);
        expect(position[1]).to.equal(-9);
        expect(position[2]).to.equal(10);
      });

      it("withdraw margin from an old position", async function () {
        await mockRouter.removeMargin(1);
        let position = await margin.traderPositionMap(owner.address);
        expect(position[0]).to.equal(-10);
        expect(position[1]).to.equal(routerAllowance + 10 - 1);
        expect(position[2]).to.equal(10);
      });

      it("withdraw maximum margin from an old long position", async function () {
        await mockRouter.removeMargin(routerAllowance - 1);
        let position = await margin.traderPositionMap(owner.address);
        expect(position[0]).to.equal(-10);
        expect(position[1]).to.equal(11);
        expect(position[2]).to.equal(10);
      });

      it("withdraw from an old position's fundingFee", async function () {
        let withdrawable = await margin.getWithdrawable(owner.address);
        await mockPriceOracle.setPf("-1000000000000000000");

        let fundingFee = (await margin.calFundingFee(owner.address)).toNumber();
        expect(fundingFee).to.be.greaterThanOrEqual(routerAllowance - withdrawable);

        await mockRouter.removeMargin(routerAllowance);
      });

      it("withdraw from an old position's unrealizedPnl", async function () {
        let withdrawable = await margin.getWithdrawable(owner.address);

        await mockAmm.setPrice(2);

        let fundingFee = (await margin.calFundingFee(owner.address)).toNumber();
        expect(fundingFee).to.be.equal(0);

        let unrealizedPnl = (await margin.calUnrealizedPnl(owner.address)).toNumber();
        expect(unrealizedPnl).to.be.greaterThanOrEqual(routerAllowance - withdrawable);

        let oldResult = await getPosition(margin, owner.address);
        await mockRouter.removeMargin(routerAllowance);
        let newResult = await getPosition(margin, owner.address);

        expect(oldResult[2] - newResult[2]).to.be.equal(unrealizedPnl);
      });
    });
  });

  describe("openPosition", async function () {
    beforeEach(async function () {
      await mockRouter.addMargin(owner.address, routerAllowance);
    });

    it("open correct long position", async function () {
      let quoteAmount = 10;
      let price = 1;
      await margin.openPosition(owner.address, longSide, quoteAmount);
      position = await margin.traderPositionMap(owner.address);
      expect(position[0]).to.equal(0 - quoteAmount * price);
      expect(position[1]).to.equal(routerAllowance + quoteAmount);
    });

    it("open correct short position", async function () {
      let quoteAmount = 10;
      let price = 1;
      await margin.openPosition(owner.address, shortSide, quoteAmount);
      position = await margin.traderPositionMap(owner.address);
      expect(position[0]).to.equal(quoteAmount * price);
      expect(position[1]).to.equal(routerAllowance - quoteAmount);
    });

    it("open wrong position", async function () {
      await expect(margin.openPosition(owner.address, longSide, 0)).to.be.revertedWith(
        "Margin.openPosition: ZERO_QUOTE_AMOUNT"
      );
    });

    it("open position with bad liquidity in amm", async function () {
      await mockAmm.setPrice(10000);
      await expect(margin.openPosition(owner.address, longSide, 1)).to.be.revertedWith(
        "Margin.openPosition: TINY_QUOTE_AMOUNT"
      );
    });

    describe("open long first, then open long", async function () {
      beforeEach(async function () {
        let quoteAmount = 10;
        await margin.removeMargin(owner.address, routerAllowance - 1);
        await margin.openPosition(owner.address, longSide, quoteAmount);
        let position = await margin.traderPositionMap(owner.address);
        expect(position[0]).to.equal(-10);
        expect(position[1]).to.equal(11);
        expect(position[2]).to.equal(10);
      });

      it("old: quote -10, base 11; add long 5X position 1: quote -5, base +5; new: quote -15, base 17; add margin 1 first", async function () {
        await mockBaseToken.transfer(margin.address, 1);
        await margin.addMargin(owner.address, 1);

        let quoteAmount = 5;
        await margin.openPosition(owner.address, longSide, quoteAmount);
        position = await margin.traderPositionMap(owner.address);
        expect(position[0]).to.equal(-15);
        expect(position[1]).to.equal(17);
        expect(position[2]).to.equal(15);
      });

      it("old: quote -10, base 11; add long 5X position 1: quote -5, base +5; new: quote -15, base 16; reverted", async function () {
        let quoteAmount = 5;
        await expect(margin.openPosition(owner.address, longSide, quoteAmount)).to.be.reverted;
      });
    });

    describe("open short first, then open long", async function () {
      beforeEach(async function () {
        let quoteAmount = 10;
        await margin.removeMargin(owner.address, routerAllowance - 1);
        await margin.openPosition(owner.address, shortSide, quoteAmount);
        let position = await margin.traderPositionMap(owner.address);
        expect(position[0]).to.equal(10);
        expect(position[1]).to.equal(-9);
        //entry price not changed
        expect(position[2]).to.equal(10);
      });

      it("old: quote 10, base -9; add long 5X, delta position: quote -5, base +5; new: quote 5, base -4", async function () {
        let quoteAmount = 5;
        await margin.openPosition(owner.address, longSide, quoteAmount);
        position = await margin.traderPositionMap(owner.address);
        expect(position[0]).to.equal(5);
        expect(position[1]).to.equal(-4);
        //entry price not changed
        expect(position[2]).to.equal(5);
      });

      it("old: quote 10, base -9; add long 15X, delta position: quote -15, base +15; new: quote -5, base 6", async function () {
        let quoteAmount = 15;
        await margin.openPosition(owner.address, longSide, quoteAmount);
        position = await margin.traderPositionMap(owner.address);
        expect(position[0]).to.equal(-5);
        expect(position[1]).to.equal(6);
        //entry price not changed
        expect(position[2]).to.equal(5);
      });

      it("old: quote 10, base -9; new price=2 and add margin 10; add long 20X, delta position: quote -20, base +10; new: quote -10, base 11", async function () {
        let quoteAmount = 20;
        await mockAmm.setPrice(2);
        await mockRouter.connect(addr1).addMargin(owner.address, 10);
        await margin.openPosition(owner.address, longSide, quoteAmount);
        position = await margin.traderPositionMap(owner.address);
        expect(position[0]).to.equal(-10);
        expect(position[1]).to.equal(11);
        //entry price changed
        expect(position[2]).to.equal(5);
        expect((await margin.calUnrealizedPnl(owner.address)).toNumber()).to.be.equal(0);
      });

      it("old: quote 10, base -9; new price=3 and add margin 10; add long 20X, delta position: quote -20, base +6; new: quote -10, base 7", async function () {
        let quoteAmount = 20;
        await mockAmm.setPrice(3);
        await mockRouter.connect(addr1).addMargin(owner.address, 10);
        await margin.openPosition(owner.address, longSide, quoteAmount);
        position = await margin.traderPositionMap(owner.address);
        expect(position[0]).to.equal(-10);
        expect(position[1]).to.equal(7);
        //entry price changed
        expect(position[2]).to.equal(3);
        expect((await margin.calUnrealizedPnl(owner.address)).toNumber()).to.be.equal(0);
      });

      it("old: quote 10, base -9; add long 21X, delta position 1: quote -21, base +21; new: quote -11, base 12; reverted", async function () {
        let quoteAmount = 21;
        await expect(margin.openPosition(owner.address, longSide, quoteAmount)).to.be.reverted;
      });
    });
  });

  describe("close position", async function () {
    beforeEach(async function () {
      await mockRouter.addMargin(owner.address, routerAllowance);
      let quoteAmount = 10;
      let price = 1;
      await margin.openPosition(owner.address, longSide, quoteAmount);
      position = await margin.traderPositionMap(owner.address);
      expect(position[0]).to.equal(0 - quoteAmount * price);
      expect(position[1]).to.equal(routerAllowance + quoteAmount);
    });

    it("close all position", async function () {
      let position = await margin.traderPositionMap(owner.address);
      await margin.closePosition(owner.address, position.quoteSize.abs());
      position = await margin.traderPositionMap(owner.address);

      expect(position[0]).to.equal(0);
    });

    it("close position partly", async function () {
      let position = await margin.traderPositionMap(owner.address);
      await margin.closePosition(owner.address, position.quoteSize.abs() - 1);
      position = await margin.traderPositionMap(owner.address);

      expect(position[0]).to.equal(-1);
    });

    it("close Null position, reverted", async function () {
      let position = await margin.traderPositionMap(owner.address);
      await margin.closePosition(owner.address, position.quoteSize.abs());

      await expect(margin.closePosition(owner.address, 10)).to.be.revertedWith("Margin.closePosition: ABOVE_POSITION");
    });

    it("close wrong position, reverted", async function () {
      let position = await margin.traderPositionMap(owner.address);
      await expect(margin.closePosition(owner.address, 0)).to.be.revertedWith("Margin.closePosition: ZERO_POSITION");
      await expect(margin.closePosition(owner.address, position.quoteSize.abs() + 1)).to.be.revertedWith(
        "Margin.closePosition: ABOVE_POSITION"
      );
    });
  });

  describe("liquidate", async function () {
    beforeEach(async function () {
      await mockRouter.connect(addr1).addMargin(addr1.address, addr1InitBaseAmount);
      let quoteAmount = 800;
      await margin.connect(addr1).openPosition(addr1.address, shortSide, quoteAmount);
    });

    it("liquidate 0 position, reverted", async function () {
      await expect(margin.connect(liquidator).liquidate(owner.address)).to.be.revertedWith(
        "Margin.liquidate: ZERO_POSITION"
      );
    });

    it("liquidate normal position, reverted", async function () {
      await expect(margin.connect(liquidator).liquidate(addr1.address)).to.be.revertedWith(
        "Margin.liquidate: NOT_LIQUIDATABLE"
      );
    });

    it("liquidate non liquidatable position", async function () {
      let quoteAmount = 10;
      await margin.connect(addr1).openPosition(addr1.address, longSide, quoteAmount);
      await expect(margin.connect(liquidator).liquidate(addr1.address)).to.be.revertedWith(
        "Margin.liquidate: NOT_LIQUIDATABLE"
      );
    });

    it("liquidate liquidatable position", async function () {
      await mockPriceOracle.setMarkPrice(100);
      await margin.connect(liquidator).liquidate(addr1.address);
    });
  });
  describe("get margin ratio", async function () {
    beforeEach(async function () {
      await mockRouter.addMargin(owner.address, 1);
      let quoteAmount = 10;
      await margin.openPosition(owner.address, longSide, quoteAmount);

      await mockRouter.addMargin(addr1.address, 1);
      await margin.connect(addr1).openPosition(addr1.address, shortSide, quoteAmount);
    });

    it("quote -10, base 11; 1/11, margin ratio is 9.09%", async function () {
      expect(await margin.getMarginRatio(owner.address)).to.equal(910);
    });

    it("quote -10, base 12; 2/12, margin ratio is 16.66%", async function () {
      await mockRouter.addMargin(owner.address, 1);
      expect(await margin.getMarginRatio(owner.address)).to.equal(1667);
    });

    it("quote 10, base -9; 1/10, margin ratio is 10.00%", async function () {
      expect(await margin.getMarginRatio(addr1.address)).to.equal(1000);
    });

    it("quote 10, base -8; 2/10, margin ratio is 20.00%", async function () {
      await mockRouter.addMargin(addr1.address, 1);
      expect(await margin.getMarginRatio(addr1.address)).to.equal(2000);
    });
  });

  describe("get withdrawable margin", async function () {
    let quoteAmount = 10;
    beforeEach(async function () {
      await mockRouter.addMargin(owner.address, 1);
      await margin.openPosition(owner.address, longSide, quoteAmount);

      await mockRouter.addMargin(addr1.address, 1);
      await margin.connect(addr1).openPosition(addr1.address, shortSide, quoteAmount);
    });

    it("quote 0, base 0; withdrawable is 0", async function () {
      await margin.openPosition(owner.address, shortSide, quoteAmount);
      await margin.removeMargin(owner.address, 1);
      expect(await margin.getWithdrawable(owner.address)).to.equal(0);
    });

    it("quote 0, base 1; withdrawable is 1", async function () {
      await margin.openPosition(owner.address, shortSide, quoteAmount);
      expect(await margin.getWithdrawable(owner.address)).to.equal(1);
    });

    it("quote 0, base 0; withdrawable is 0", async function () {
      await margin.openPosition(owner.address, shortSide, quoteAmount);
      await margin.removeMargin(owner.address, 1);
      expect(await margin.getWithdrawable(owner.address)).to.equal(0);
    });

    it("quote 0, base 1; withdrawable is 1", async function () {
      await margin.openPosition(owner.address, shortSide, quoteAmount);
      expect(await margin.getWithdrawable(owner.address)).to.equal(1);
    });

    it("quote -10, base 11; withdrawable is 0", async function () {
      expect(await margin.getWithdrawable(owner.address)).to.equal(0);
    });

    it("quote -10, base 12; withdrawable is 1", async function () {
      await mockRouter.addMargin(owner.address, 1);
      expect(await margin.getWithdrawable(owner.address)).to.equal(1);
    });

    it("quote 10, base -9; withdrawable is 0", async function () {
      expect(await margin.getWithdrawable(addr1.address)).to.equal(0);
    });

    it("quote 10, base -8; withdrawable is 1", async function () {
      await mockRouter.addMargin(addr1.address, 1);
      expect(await margin.getWithdrawable(addr1.address)).to.equal(1);
    });
  });

  describe("updateCPF", async function () {
    it("can update frequently and directly", async function () {
      await margin.updateCPF();
      let latestUpdateCPF1 = await margin.lastUpdateCPF();
      await margin.updateCPF();
      let latestUpdateCPF2 = await margin.lastUpdateCPF();
      expect(latestUpdateCPF2.toNumber()).to.be.greaterThan(latestUpdateCPF1.toNumber());
    });

    it("can update frequently and indirectly", async function () {
      await mockRouter.addMargin(owner.address, 8);
      await mockRouter.removeMargin(1);
      let latestUpdateCPF1 = await margin.lastUpdateCPF();
      await mockRouter.removeMargin(1);
      let latestUpdateCPF2 = await margin.lastUpdateCPF();
      expect(latestUpdateCPF2.toNumber()).to.be.greaterThan(latestUpdateCPF1.toNumber());
    });
  });

  describe("calFundingFee", async function () {
    let quoteAmount = 10;
    beforeEach(async function () {
      await mockRouter.addMargin(owner.address, 1);
      await margin.openPosition(owner.address, longSide, quoteAmount); //start to pay funding fee
      await mockPriceOracle.setPf("1000000000000000000"); //1e18
    });

    it("check funding fee at different timestamp", async function () {
      //maxBoost*baseAmount*pf*time
      expect((await margin.calFundingFee(owner.address)).toNumber()).to.be.equal(-100);

      await margin.updateCPF();
      expect((await margin.calFundingFee(owner.address)).toNumber()).to.be.equal(-200);
      let latestUpdateCPF1 = await margin.lastUpdateCPF();

      await sleep(5000);
      //@notice: in hardhat, block.timestamp is former block timestamp, so time == 0
      expect((await margin.calFundingFee(owner.address)).toNumber()).to.be.equal(-200);

      await margin.updateCPF();
      expect((await margin.calFundingFee(owner.address)).toNumber()).to.be.greaterThanOrEqual(-800);
      let latestUpdateCPF2 = await margin.lastUpdateCPF();

      expect(latestUpdateCPF2.toNumber()).to.be.greaterThan(latestUpdateCPF1.toNumber());
    });
  });
});

async function getPosition(margin, address) {
  let position = await margin.traderPositionMap(address);
  var result = [];
  // console.log("quote, base, trade: ", position[0].toNumber(), position[1].toNumber(), position[2].toNumber());
  result.push(position[0].toNumber());
  result.push(position[1].toNumber());
  result.push(position[2].toNumber());
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
