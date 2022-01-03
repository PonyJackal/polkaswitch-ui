import _ from 'underscore';
import EventManager from './events';
import Wallet from './wallet';
import TxQueue from './txQueue';
import * as ethers from 'ethers';
import TokenListManager from './tokenList';
import Storage from './storage';
import BN from 'bignumber.js';
import { ApprovalState } from '../constants/Status';

import { BigNumber, constants, Signer, utils } from 'ethers';
import {
  ActiveTransaction,
  NxtpSdk,
  NxtpSdkEvents,
  HistoricalTransaction,
} from '@connext/nxtp-sdk';
import {
  AuctionResponse,
  ChainData,
  CrosschainTransaction,
  getRandomBytes32,
  getChainData,
  Logger,
  TransactionPreparedEvent,
} from "@connext/nxtp-utils";
import swapFn from "./swapFn";

// never exponent
BN.config({ EXPONENTIAL_AT: 1e9 });

let store = require('store');

window.NxtpUtils = {
  _queue: {},
  _sdk: false,

  _activeTxs: [],
  _historicalTxs: [],

  _storeKey: () => {
    return `connext_${Wallet.currentAddress()}`;
  },

  _sdkConfig: false,
  _connextChainData: false,

  initalize: async function() {
    this._connextChainData = await getChainData();
    this._prepSdkConfig();

    EventManager.listenFor('walletUpdated', this.resetSdk.bind(this));

    if (Wallet.isConnected()) {
      this._sdk = await this.initalizeSdk();
    }
  },

  _prepSdkConfig: function() {
    this._sdkConfig = {};

    window.NETWORK_CONFIGS.forEach((e) => {
      if (e.enabled && e.crossChainSupported) {
        var connextData = this._connextChainData.get(e.chainId);

        this._sdkConfig[e.chainId] = {
          providers: e.nodeProviders,
          subgraph: connextData?.subgraph
        }
      }
    });
  },

  isSdkInitalized: function() {
    return !!this._sdk;
  },

  initalizeSdk: async function () {
    const signer = Wallet.getProvider().getSigner();

    var sdk = (this._sdk = new NxtpSdk({
      chainConfig: this._sdkConfig,
      signer: signer,
      logger: new Logger({ name: 'NxtpSdk', level: 'info' }),
      network: process.env.REACT_APP_NETWORK || 'mainnet',
    }));

    this.attachNxtpSdkListeners(sdk);
    return sdk;
  },

  resetSdk: function () {
    console.log('Nxtp SDK reset');

    if (this._sdk) {
      //detach all listeners
      this._sdk.removeAllListeners();
      this._sdk.detach();
    }

    this._sdk = false;
    this._queue = {};
    this._activeTxs = [];
    this._historicalTxs = [];
  },

  fetchActiveTxs: async function () {
    if (!this._sdk) {
      return;
    }
    this._activeTxs = await this._sdk.getActiveTransactions();
    console.log('activeTxs: ', this._activeTxs);
  },

  fetchHistoricalTxs: async function () {
    if (!this._sdk) {
      return;
    }
    this._historicalTxs = await this._sdk.getHistoricalTransactions();
    console.log('historicalTxs: ', this._historicalTxs);
  },

  attachNxtpSdkListeners: function (_sdk) {
    if (!_sdk) {
      return;
    }
    _sdk.attach(NxtpSdkEvents.SenderTransactionPrepared, (data) => {
      console.log('SenderTransactionPrepared:', data);
      const { amount, expiry, preparedBlockNumber, ...invariant } = data.txData;

      const index = this._activeTxs.findIndex(
        (col) =>
          col.crosschainTx.invariant.transactionId === invariant.transactionId,
      );

      if (index === -1) {
        this._activeTxs.push({
          crosschainTx: {
            invariant,
            sending: { amount, expiry, preparedBlockNumber },
          },
          preparedTimestamp: Math.floor(Date.now() / 1000),
          bidSignature: data.bidSignature,
          encodedBid: data.encodedBid,
          encryptedCallData: data.encryptedCallData,
          status: NxtpSdkEvents.SenderTransactionPrepared,
        });
      } else {
        const item = { ...this._activeTxs[index] };
        this._activeTxs[index] = {
          ...item,
          preparedTimestamp: Math.floor(Date.now() / 1000),
          bidSignature: data.bidSignature,
          encodedBid: data.encodedBid,
          encryptedCallData: data.encryptedCallData,
          status: NxtpSdkEvents.SenderTransactionPrepared,
          crosschainTx: {
            ...item.crosschainTx,
            sending: { amount, expiry, preparedBlockNumber },
          },
        };
      }

      EventManager.emitEvent(
        'nxtpEventUpdated',
        NxtpSdkEvents.SenderTransactionPrepared,
      );
    });

    _sdk.attach(NxtpSdkEvents.SenderTransactionFulfilled, async (data) => {
      console.log('SenderTransactionFulfilled:', data);
      this.removeActiveTx(data.txData.transactionId);
      EventManager.emitEvent(
        'nxtpEventUpdated',
        NxtpSdkEvents.SenderTransactionFulfilled,
      );
    });

    _sdk.attach(NxtpSdkEvents.SenderTransactionCancelled, async (data) => {
      console.log('SenderTransactionCancelled:', data);
      this.removeActiveTx(data.txData.transactionId);
      await this.fetchHistoricalTxs();
      EventManager.emitEvent(
        'nxtpEventUpdated',
        NxtpSdkEvents.SenderTransactionCancelled,
      );
    });

    _sdk.attach(NxtpSdkEvents.ReceiverTransactionPrepared, (data) => {
      console.log('ReceiverTransactionPrepared:', data);
      const { amount, expiry, preparedBlockNumber, ...invariant } = data.txData;
      const index = this._activeTxs.findIndex(
        (col) =>
          col.crosschainTx.invariant.transactionId === invariant.transactionId,
      );

      if (index === -1) {
        this._activeTxs.push({
          preparedTimestamp: Math.floor(Date.now() / 1000),
          crosschainTx: {
            invariant,
            sending: {}, // Find to do this, since it defaults to receiver side info
            receiving: { amount, expiry, preparedBlockNumber },
          },
          bidSignature: data.bidSignature,
          encodedBid: data.encodedBid,
          encryptedCallData: data.encryptedCallData,
          status: NxtpSdkEvents.ReceiverTransactionPrepared,
        });
      } else {
        const item = { ...this._activeTxs[index] };
        this._activeTxs[index] = {
          ...item,
          status: NxtpSdkEvents.ReceiverTransactionPrepared,
          crosschainTx: {
            ...item.crosschainTx,
            receiving: { amount, expiry, preparedBlockNumber },
          },
        };
      }

      EventManager.emitEvent(
        'nxtpEventUpdated',
        NxtpSdkEvents.ReceiverTransactionPrepared,
      );
    });

    _sdk.attach(NxtpSdkEvents.ReceiverPrepareSigned, async (data) => {
      console.log('ReceiverPrepareSigned:', data);
      this.updateActiveTx(
        data.transactionId,
        NxtpSdkEvents.ReceiverPrepareSigned,
      );
      EventManager.emitEvent(
        'nxtpEventUpdated',
        NxtpSdkEvents.ReceiverPrepareSigned,
      );
    });

    _sdk.attach(NxtpSdkEvents.ReceiverTransactionFulfilled, async (data) => {
      console.log('ReceiverTransactionFulfilled:', data);
      this.updateActiveTx(
        data.txData.transactionId,
        NxtpSdkEvents.ReceiverTransactionFulfilled,
        data,
        { invariant: data.txData, receiving: data.txData },
      );
      this.removeActiveTx(data.txData.transactionId);
      await this.fetchHistoricalTxs();
      EventManager.emitEvent(
        'nxtpEventUpdated',
        NxtpSdkEvents.ReceiverTransactionFulfilled,
      );
    });

    _sdk.attach(NxtpSdkEvents.ReceiverTransactionCancelled, async (data) => {
      console.log('ReceiverTransactionCancelled:', data);
      this.updateActiveTx(
        data.txData.transactionId,
        NxtpSdkEvents.ReceiverTransactionCancelled,
        data,
        { invariant: data.txData, receiving: data.txData },
      );
      this.removeActiveTx(data.txData.transactionId);
      await this.fetchHistoricalTxs();
      EventManager.emitEvent(
        'nxtpEventUpdated',
        NxtpSdkEvents.ReceiverTransactionCancelled,
      );
    });

    _sdk.attach(NxtpSdkEvents.SenderTokenApprovalMined, (data) => {
      console.log('SenderTokenApprovalMined:', data);
    });

    _sdk.attach(NxtpSdkEvents.SenderTransactionPrepareSubmitted, (data) => {
      console.log('SenderTransactionPrepareSubmitted:', data);
    });
  },

  getHistoricalTx: function (transactionId) {
    return this._historicalTxs.find(
      (t) => t.crosschainTx.invariant.transactionId === transactionId,
    );
  },

  isActiveTxFinishable: function (transactionId) {
    var tx = this.getActiveTx(transactionId);

    if (!tx) {
      return false;
    } else {
      return tx.status === NxtpSdkEvents.ReceiverTransactionPrepared;
    }
  },

  isActiveTxFinished: function (transactionId) {
    var tx = this.getHistoricalTx(transactionId);
    console.log('isActiveTxFinished: ', tx);
    return !!tx;
  },

  getActiveTx: function (transactionId) {
    return this._activeTxs.find(
      (t) => t.crosschainTx.invariant.transactionId === transactionId,
    );
  },

  updateActiveTx: function (transactionId, status, event, crosschainTx) {
    let updated = false;
    this._activeTxs = this._activeTxs.map((item) => {
      if (item.crosschainTx.invariant.transactionId === transactionId) {
        if (crosschainTx) {
          item.crosschainTx = Object.assign(
            {},
            item.crosschainTx,
            crosschainTx,
          );
        }
        item.status = status;
        if (event) {
          item.event = event;
        }
        updated = true;
      }
      return item;
    });

    if (!updated && crosschainTx) {
      this._activeTxs.push({ crosschainTx: crosschainTx, status, event });
    }
  },

  removeActiveTx: function (transactionId) {
    this._activeTxs = this._activeTxs.filter((t) => {
      return t.crosschainTx.invariant.transactionId !== transactionId;
    });
  },

  getEstimate: async function (
    transactionId,
    sendingChainId,
    sendingAssetId,
    receivingChainId,
    receivingAssetId,
    amountBN,
    receivingAddress,
  ) {
    if (!Wallet.isConnected()) {
      console.error('Nxtp: Wallet not connected');
      return false;
    }

    if (!this._sdk) {
      this._sdk = await this.initalizeSdk();
    }

    const sendingChain = TokenListManager.getNetworkById(sendingChain);
    const receivingChain = TokenListManager.getNetworkById(receivingChainId);
    const receivingAsset = TokenListManager.findTokenById(
      receivingAssetId,
      receivingChain,
    );
    const sendingAsset = TokenListManager.findTokenById(sendingAssetId);
    const bridgeAsset = TokenListManager.findTokenById(
      sendingAsset.symbol,
      receivingChain,
    );

    let callToAddr, callData, expectedReturn;

    // if same token on both chains, don't do getExpectedReturn
    if (bridgeAsset.address !== receivingAsset.address) {
      callToAddr = receivingChain.crossChainAggregatorAddress;
      console.log(`callToAddr = ${callToAddr}`);

      let aggregator = new utils.Interface(window.crossChainOneSplitAbi);

      // NXTP has a 0.05% flat fee
      let o1 = BN(utils.formatUnits(amountBN, sendingAsset.decimals))
        .times(0.9995)
        .times(10 ** bridgeAsset.decimals)
        .toString();
      let estimatedOutputBN = utils.parseUnits(
        swapFn.validateEthValue(bridgeAsset, o1),
        0,
      );

      expectedReturn = await swapFn.getExpectedReturn(
        bridgeAsset,
        receivingAsset,
        estimatedOutputBN,
        receivingChainId,
      );

      let distBN = _.map(expectedReturn.distribution, function (e) {
        return window.ethers.utils.parseUnits('' + e, 'wei');
      });

      // TODO missing the options i.e { gasprice, value }
      callData = aggregator.encodeFunctionData('swap', [
        bridgeAsset.address,
        receivingAssetId,
        estimatedOutputBN,
        BigNumber.from(0), //TODO: Add MinReturn/Slippage
        receivingAddress,
        distBN,
        0,
      ]);
    }

    const quote = await this._sdk.getTransferQuote({
      callData,
      sendingAssetId,
      sendingChainId,
      receivingChainId,
      receivingAssetId: bridgeAsset.address,
      receivingAddress,
      amount: amountBN.toString(),
      transactionId,
      expiry: Math.floor(Date.now() / 1000) + 3600 * 24 * 3, // 3 days
      callTo: callToAddr,
    });

    this._queue[transactionId] = {
      quote: quote,
      expectedReturn: expectedReturn,
    };

    return {
      id: transactionId,
      transactionFee: 0.0, // TODO
      returnAmount: expectedReturn
        ? expectedReturn.returnAmount
        : quote.bid.amountReceived,
    };
  },

  transferStepOne: async function (transactionId) {
    const transferQuote = this._queue[transactionId]?.quote;

    if (!transferQuote) {
      throw new Error('Please request quote first');
    }

    if (!Wallet.isConnected()) {
      //if (injectedProviderChainId !== auctionResponse.bid.sendingChainId) {
      return false;
    }

    const transfer = await this._sdk.prepareTransfer(transferQuote, true);
    console.log('transfer: ', transfer);
    // WAIT on Events at this point

    return true;
  },

  transferStepTwo: async function (transactionId) {
    const tx = this.getActiveTx(transactionId);

    const { bidSignature, encodedBid, encryptedCallData } = tx;
    const { receiving, sending, invariant } = tx.crosschainTx;
    const variant = receiving ?? sending;
    const sendingTxData = {
      ...invariant,
      ...sending,
    };

    const receivingTxData =
      typeof receiving === 'object'
        ? {
            ...invariant,
            ...receiving,
          }
        : undefined;

    const finish = await this._sdk.fulfillTransfer({
      bidSignature,
      encodedBid,
      encryptedCallData,
      txData: receivingTxData,
    });

    console.log('finish: ', finish);

    if (
      finish.metaTxResponse?.transactionHash ||
      finish.metaTxResponse?.transactionHash === ''
    ) {
      this.removeActiveTx(receivingTxData.transactionId);
    }

    return true;
  },

  getAllActiveTxs: function () {
    return this._activeTxs.map((x) => x);
  },

  getAllHistoricalTxs: function () {
    return this._historicalTxs.map((x) => x);
  },
};

export default window.NxtpUtils;
