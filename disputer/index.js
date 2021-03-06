require("dotenv").config();
const { toBN } = web3.utils;

// Helpers
const { delay } = require("../financial-templates-lib/helpers/delay");
const { Logger, waitForLogger } = require("../financial-templates-lib/logger/Logger");
const { MAX_UINT_VAL } = require("../common/Constants");

// JS libs
const { Disputer } = require("./disputer");
const { GasEstimator } = require("../financial-templates-lib/helpers/GasEstimator");
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyClient");
const { createPriceFeed } = require("../financial-templates-lib/price-feed/CreatePriceFeed");
const { Networker } = require("../financial-templates-lib/price-feed/Networker");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");

/**
 * @notice Continuously attempts to dispute liquidations in the EMP contract.
 * @param {String} address Contract address of the EMP.
 * @param {bool} shouldPoll Whether to poll continuously or run a single iteration (for testing).
 * @param {Number} pollingDelay Number of seconds to delay between polls.
 * @param {Object} priceFeedConfig Configuration to construct the price feed object.
 * @param {Object} [disputerConfig] Configuration to construct the disputer.
 * @return None or throws an Error.
 */
async function run(address, shouldPoll, pollingDelay, priceFeedConfig, disputerConfig) {
  try {
    Logger.info({
      at: "Disputer#index",
      message: "Disputer started🔎",
      empAddress: address,
      pollingDelay: pollingDelay,
      priceFeedConfig
    });

    // Setup web3 accounts an contract instance
    const accounts = await web3.eth.getAccounts();
    const emp = await ExpiringMultiParty.at(address);

    // Setup price feed.
    const getTime = () => Math.round(new Date().getTime() / 1000);
    const priceFeed = await createPriceFeed(Logger, web3, new Networker(Logger), getTime, priceFeedConfig);

    if (!priceFeed) {
      throw new Error("Price feed config is invalid");
    }

    // Client and dispute bot.
    const empClient = new ExpiringMultiPartyClient(Logger, ExpiringMultiParty.abi, web3, emp.address);
    const gasEstimator = new GasEstimator(Logger);
    const disputer = new Disputer(Logger, empClient, gasEstimator, priceFeed, accounts[0], disputerConfig);

    // The EMP requires approval to transfer the disputer's collateral tokens in order to dispute a liquidation.
    // We'll set this once to the max value and top up whenever the bot's allowance drops below MAX_INT / 2.
    const collateralToken = await ExpandedERC20.at(await emp.collateralCurrency());
    const currentAllowance = await collateralToken.allowance(accounts[0], empClient.empAddress);
    if (toBN(currentAllowance).lt(toBN(MAX_UINT_VAL).div(toBN("2")))) {
      const collateralApprovalTx = await collateralToken.approve(empClient.empAddress, MAX_UINT_VAL, {
        from: accounts[0]
      });
      Logger.info({
        at: "Disputer#index",
        message: "Approved EMP to transfer unlimited collateral tokens 💰",
        collateralApprovalTx: collateralApprovalTx.transactionHash
      });
    }

    while (true) {
      await disputer.queryAndDispute();
      await disputer.queryAndWithdrawRewards();

      await delay(Number(pollingDelay));

      if (!shouldPoll) {
        break;
      }
    }
  } catch (error) {
    Logger.error({
      at: "Disputer#index🚨",
      message: "Disputer error",
      error: typeof error === "string" ? new Error(error) : error
    });
    await waitForLogger(Logger);
  }
}

const Poll = async function(callback) {
  try {
    if (!process.env.EMP_ADDRESS) {
      throw new Error(
        "Bad input arg! Specify an `EMP_ADDRESS` for the location of the expiring Multi Party within your environment variables."
      );
    }

    const pollingDelay = process.env.POLLING_DELAY ? process.env.POLLING_DELAY : 10000;

    if (!process.env.PRICE_FEED_CONFIG) {
      throw new Error(
        "Bad input arg! Specify a `PRICE_FEED_CONFIG` for price feed config for the disputer bot to use."
      );
    }
    // Read price feed configuration from an environment variable. This can be a crypto watch, medianizer or uniswap
    // price feed Config defines the exchanges to use. EG with medianizer: {"type":"medianizer","pair":"ethbtc",
    // "lookback":7200, "minTimeBetweenUpdates":60,"medianizedFeeds":[{"type":"cryptowatch","exchange":"coinbase-pro"},
    // {"type":"cryptowatch","exchange":"binance"}]}
    const priceFeedConfig = JSON.parse(process.env.PRICE_FEED_CONFIG);

    // If there is a disputer config, add it. Else, set to null. This config contains disputeDelay and txnGasLimit. EG:
    // {"disputeDelay":60,"txnGasLimit":9000000}
    const disputerConfig = process.env.DISPUTER_CONFIG ? process.env.DISPUTER_CONFIG : null;

    await run(process.env.EMP_ADDRESS, true, pollingDelay, priceFeedConfig, disputerConfig);
  } catch (error) {
    Logger.error({
      at: "Disputer#index🚨",
      message: "Disputer configuration error",
      error: typeof error === "string" ? new Error(error) : error
    });
    await waitForLogger(Logger);
    callback(error);
    return;
  }
  callback();
};

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
Poll.run = run;
module.exports = Poll;
