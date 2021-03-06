// A thick client for getting information about an ExpiringMultiParty events. This client is kept separate from the
// ExpiringMultiPartyClient to keep a clear separation of concerns and to limit the overhead from querying the chain.

class ExpiringMultiPartyEventClient {
  /**
   * @notice Constructs new ExpiringMultiPartyClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} empAbi Expiring Multi Party truffle ABI object to create a contract instance.
   * @param {Object} web3 Web3 provider from truffle instance.
   * @param {String} empAddress Ethereum address of the EMP contract deployed on the current network.
   * @param {Integer} latestBlockNumber Offset block number to index events from.
   * @return None or throws an Error.
   */
  constructor(logger, empAbi, web3, empAddress, latestBlockNumber = 0) {
    this.logger = logger;
    this.web3 = web3;

    // EMP contract
    this.emp = new this.web3.eth.Contract(empAbi, empAddress);
    this.empAddress = empAddress;

    // EMP Events data structure to enable synchronous retrieval of information.
    this.liquidationEvents = [];
    this.disputeEvents = [];
    this.disputeSettlementEvents = [];
    this.newSponsorEvents = [];
    this.depositEvents = [];
    this.createEvents = [];
    this.withdrawEvents = [];
    this.redeemEvents = [];
    this.regularFeeEvents = [];
    this.finalFeeEvents = [];
    this.liquidationWithdrawnEvents = [];
    this.settleExpiredPositionEvents = [];

    // First block number to begin searching for events after.
    this.firstBlockToSearch = latestBlockNumber;
    this.lastUpdateTimestamp = 0;
  }
  // Delete all events within the client
  clearState = async () => {
    this.liquidationEvents = [];
    this.disputeEvents = [];
    this.disputeSettlementEvents = [];
    this.newSponsorEvents = [];
    this.depositEvents = [];
    this.createEvents = [];
    this.withdrawEvents = [];
    this.redeemEvents = [];
    this.regularFeeEvents = [];
    this.finalFeeEvents = [];
    this.liquidationWithdrawnEvents = [];
    this.settleExpiredPositionEvents = [];
  };

  getAllNewSponsorEvents = () => this.newSponsorEvents;

  getAllLiquidationEvents = () => this.liquidationEvents;

  getAllDisputeEvents = () => this.disputeEvents;

  getAllDisputeSettlementEvents = () => this.disputeSettlementEvents;

  getAllDepositEvents = () => this.depositEvents;

  getAllCreateEvents = () => this.createEvents;

  getAllWithdrawEvents = () => this.withdrawEvents;

  getAllRedeemEvents = () => this.redeemEvents;

  getAllRegularFeeEvents = () => this.regularFeeEvents;

  getAllFinalFeeEvents = () => this.finalFeeEvents;

  getAllLiquidationWithdrawnEvents = () => this.liquidationWithdrawnEvents;

  getAllSettleExpiredPositionEvents = () => this.settleExpiredPositionEvents;

  // Returns the last update timestamp.
  getLastUpdateTime = () => this.lastUpdateTimestamp;

  update = async () => {
    const currentBlockNumber = await this.web3.eth.getBlockNumber();
    // TODO(#1540): For efficiency, we should only pass through `fromBlock` to `toBlock` once and check for
    // all of the relevant events along the way.

    // Look for events on chain from the previous seen block number to the current block number.
    // Liquidation events
    const liquidationEventsObj = await this.emp.getPastEvents("LiquidationCreated", {
      fromBlock: this.firstBlockToSearch,
      toBlock: currentBlockNumber
    });

    // Liquidation events.
    for (let event of liquidationEventsObj) {
      this.liquidationEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        liquidator: event.returnValues.liquidator,
        liquidationId: event.returnValues.liquidationId,
        tokensOutstanding: event.returnValues.tokensOutstanding,
        lockedCollateral: event.returnValues.lockedCollateral,
        liquidatedCollateral: event.returnValues.liquidatedCollateral
      });
    }

    // Dispute events.
    const disputeEventsObj = await this.emp.getPastEvents("LiquidationDisputed", {
      fromBlock: this.firstBlockToSearch,
      toBlock: currentBlockNumber
    });
    for (let event of disputeEventsObj) {
      this.disputeEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        liquidator: event.returnValues.liquidator,
        disputer: event.returnValues.disputer,
        liquidationId: event.returnValues.liquidationId,
        disputeBondAmount: event.returnValues.disputeBondAmount
      });
    }

    // Dispute settlement events.
    const disputeSettlementEventsObj = await this.emp.getPastEvents("DisputeSettled", {
      fromBlock: this.firstBlockToSearch,
      toBlock: currentBlockNumber
    });
    for (let event of disputeSettlementEventsObj) {
      this.disputeSettlementEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        caller: event.returnValues.caller,
        sponsor: event.returnValues.sponsor,
        liquidator: event.returnValues.liquidator,
        disputer: event.returnValues.disputer,
        liquidationId: event.returnValues.liquidationId,
        disputeSucceeded: event.returnValues.disputeSucceeded
      });
    }

    // Create events.
    const createEventsObj = await this.emp.getPastEvents("PositionCreated", {
      fromBlock: this.firstBlockToSearch,
      toBlock: currentBlockNumber
    });
    for (let event of createEventsObj) {
      this.createEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: event.returnValues.collateralAmount,
        tokenAmount: event.returnValues.tokenAmount
      });
    }

    // NewSponsor events mapped against PositionCreated events to determine size of new positions created.
    const newSponsorEventsObj = await this.emp.getPastEvents("NewSponsor", {
      fromBlock: this.firstBlockToSearch,
      toBlock: currentBlockNumber
    });
    for (let event of newSponsorEventsObj) {
      // Every transaction that emits a NewSponsor event must also emit a PositionCreated event.
      // We assume that there is only one PositionCreated event that has the same block number as
      // the current NewSponsor event.
      const createEvent = this.createEvents.filter(e => e.blockNumber === event.blockNumber);

      this.newSponsorEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: createEvent[0].collateralAmount,
        tokenAmount: createEvent[0].tokenAmount
      });
    }

    // Deposit events.
    const depositEventsObj = await this.emp.getPastEvents("Deposit", {
      fromBlock: this.firstBlockToSearch,
      toBlock: currentBlockNumber
    });
    for (let event of depositEventsObj) {
      this.depositEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: event.returnValues.collateralAmount
      });
    }

    // Withdraw events.
    const withdrawEventsObj = await this.emp.getPastEvents("Withdrawal", {
      fromBlock: this.firstBlockToSearch,
      toBlock: currentBlockNumber
    });
    for (let event of withdrawEventsObj) {
      this.withdrawEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: event.returnValues.collateralAmount
      });
    }

    // Redeem events.
    const redeemEventsObj = await this.emp.getPastEvents("Redeem", {
      fromBlock: this.firstBlockToSearch,
      toBlock: currentBlockNumber
    });
    for (let event of redeemEventsObj) {
      this.redeemEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: event.returnValues.collateralAmount,
        tokenAmount: event.returnValues.tokenAmount
      });
    }

    // Regular fee events.
    const regularFeeEventsObj = await this.emp.getPastEvents("RegularFeesPaid", {
      fromBlock: this.firstBlockToSearch,
      toBlock: currentBlockNumber
    });
    for (let event of regularFeeEventsObj) {
      this.regularFeeEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        regularFee: event.returnValues.regularFee,
        lateFee: event.returnValues.lateFee
      });
    }

    // Final fee events.
    const finalFeeEventsObj = await this.emp.getPastEvents("FinalFeesPaid", {
      fromBlock: this.firstBlockToSearch,
      toBlock: currentBlockNumber
    });
    for (let event of finalFeeEventsObj) {
      this.finalFeeEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        amount: event.returnValues.amount
      });
    }

    // Liquidation withdrawn events.
    const liquidationWithdrawnEventsObj = await this.emp.getPastEvents("LiquidationWithdrawn", {
      fromBlock: this.firstBlockToSearch,
      toBlock: currentBlockNumber
    });
    for (let event of liquidationWithdrawnEventsObj) {
      this.liquidationWithdrawnEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        caller: event.returnValues.caller,
        withdrawalAmount: event.returnValues.withdrawalAmount,
        liquidationStatus: event.returnValues.liquidationStatus
      });
    }

    // Settle expired position events.
    const settleExpiredPositionEventsObj = await this.emp.getPastEvents("SettleExpiredPosition", {
      fromBlock: this.firstBlockToSearch,
      toBlock: currentBlockNumber
    });
    for (let event of settleExpiredPositionEventsObj) {
      this.settleExpiredPositionEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        caller: event.returnValues.caller,
        collateralReturned: event.returnValues.collateralReturned,
        tokensBurned: event.returnValues.tokensBurned
      });
    }

    // Add 1 to current block so that we do not double count the last block number seen.
    this.firstBlockToSearch = currentBlockNumber + 1;

    this.lastUpdateTimestamp = await this.emp.methods.getCurrentTime().call();
    this.logger.debug({
      at: "ExpiringMultiPartyEventClient",
      message: "Expiring multi party event state updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp
    });
  };
}

module.exports = {
  ExpiringMultiPartyEventClient
};
