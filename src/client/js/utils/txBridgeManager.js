import _ from 'underscore';
import { BigNumber, constants, providers, Signer, utils } from 'ethers';
import { getRandomBytes32 } from '@connext/nxtp-utils';
import { mappingToGenerateConnextArray, mappingToGenerateArrayAnyBridge } from './bridgeManagerMappings';

import HopUtils from './hop';
import CBridgeUtils from './cbridge';
import Nxtp from './nxtp';
import Storage from './storage';

const BRIDGES = ['hop', 'cbridge', 'connext'];

// hard-code for now, the HopSDK has "supportedChains", but let's integrate later.
const HOP_SUPPORTED_CHAINS = [1, 137, 100, 10, 42161];

const CBRIDGE_SUPPORTED_CHAINS = [1, 10, 56, 137, 250, 42161, 43114];

const CONNEXT_SUPPORTED_CHAINS = [1, 56, 137, 100, 250, 42161, 43114];

const CONNEXT_SUPPORTED_BRIDGE_TOKENS = [
  'USDC',
  'USDT',
  'DAI',
  // TODO This is list is longer and is dynamically available per network pair.
  // Let's keep it simple for now
  // ... "MATIC", "ETH", "WBTC", "BNB"
];

// hard-code for now. I could not find this easily as a function in HopSDK
const HOP_SUPPORTED_BRIDGE_TOKENS = [
  'USDC',
  'USDT',
  'DAI',
  // TODO This is list is longer and is dynamically available per network pair.
  // Let's keep it simple for now
  // ... "MATIC", "ETH", "WBTC"
];

const CBRIDGE_SUPPORTED_BRIDGE_TOKENS = [
  'USDC',
  'USDT',
  // TODO This is list is longer and is dynamically available per network pair.
  // Let's keep it simple for now
  // ... "MATIC", "ETH", "WBTC"
];

export default {
  _signerAddress: '',
  _queue: {},
  _routes: {},
  _genericTxHistory: [],
  _activeTxHistory: [],

  async initialize() {},

  // TODO merge into getBridgeInterface, to avoid conflicts
  getBridge(type) {
    if (type === 'hop') {
      return HopUtils;
    }
    if (type === 'cbridge') {
      return CBridgeUtils;
    }
    return Nxtp;
  },

  // TODO this is deprecated
  getBridgeInterface(nonce) {
    const tx = this.getTx(nonce);
    let { bridgeOption } = Storage.swapSettings;

    if (tx?.bridge) {
      bridgeOption = tx.bridge;
    }

    if (bridgeOption === 'hop') {
      return HopUtils;
    }
    if (bridgeOption === 'cbridge') {
      return CBridgeUtils;
    }
    return Nxtp;
  },

  supportedBridges(to, toChain, from, fromChain) {
    const bridges = [];
    const targetChainIds = [+toChain.chainId, +fromChain.chainId];
    const targetTokenIds = [to.symbol, from.symbol];

    // This also controls the order they appear in the UI

    if (targetChainIds.every((e) => CBRIDGE_SUPPORTED_CHAINS.includes(e))) {
      if (
        to.symbol === from.symbol &&
        targetTokenIds.every((e) => CBRIDGE_SUPPORTED_BRIDGE_TOKENS.includes(e))
      ) {
        bridges.push('cbridge');
      }
    }

    if (targetChainIds.every((e) => HOP_SUPPORTED_CHAINS.includes(e))) {
      if (
        to.symbol === from.symbol &&
        targetTokenIds.every((e) => HOP_SUPPORTED_BRIDGE_TOKENS.includes(e))
      ) {
        bridges.push('hop');
      }
    }

    if (targetChainIds.every((e) => CONNEXT_SUPPORTED_CHAINS.includes(e))) {
      // Connext always supported regardless of token due to the extra swap steps
      bridges.push('connext');
    }

    return bridges;
  },

  getAllEstimates(to, toChain, from, fromChain, amountBN, receivingAddress) {
    const parentTransactionId = getRandomBytes32();
    this._routes[parentTransactionId] = {};

    const supportedBridges = this.supportedBridges(
      to,
      toChain,
      from,
      fromChain,
    );

    return supportedBridges.map((bridgeType) => {
      const txData = {
        bridge: bridgeType,
        sendingChainId: +fromChain.chainId,
        sendingAssetId: from.address,
        receivingChainId: +toChain.chainId,
        receivingAssetId: to.address,
        amountBN,
        receivingAddress,
      };

      const childTransactionId = getRandomBytes32();
      this._routes[parentTransactionId][bridgeType] = _.extend({}, txData);
      this._queue[childTransactionId] = _.extend({}, txData);

      return this.getBridge(bridgeType)
        .getEstimate(
          childTransactionId,
          +fromChain.chainId,
          from.address,
          +toChain.chainId,
          to.address,
          amountBN,
          receivingAddress,
        )
        .then((estimate) => {
          this._routes[parentTransactionId][bridgeType].estimate = estimate;
          this._queue[childTransactionId].estimate = estimate;

          if (!estimate?.hasMinBridgeAmount) {
            this._routes[parentTransactionId][bridgeType] = null;
          }

          return this._routes[parentTransactionId][bridgeType];
        });
    });
  },

  transferStepOne(transactionId) {
    const bridgeInterface = this.getBridgeInterface(transactionId);
    const tx = this.getTx(transactionId);

    return bridgeInterface.transferStepOne(
      transactionId,
      tx.sendingChainId,
      tx.sendingAssetId,
      tx.receivingChainId,
      tx.receivingAssetId,
      tx.amountBN,
      tx.receivingAddress,
      tx.estimate.maxSlippage,
    );
  },

  transferStepTwo(transactionId, txBridgeInternalId) {
    const bridgeInterface = this.getBridgeInterface(transactionId);
    const tx = this.getTx(transactionId);

    if (tx.bridge === 'cbridge') {
      return bridgeInterface.transferStepTwo(txBridgeInternalId);
    }

    return bridgeInterface.transferStepTwo(
      transactionId,
      tx.sendingChainId,
      tx.sendingAssetId,
      tx.receivingChainId,
      tx.receivingAssetId,
      tx.amountBN,
      tx.receivingAddress,
    );
  },

  twoStepTransferRequired(nonce) {
    const tx = this.getTx(nonce);
    if (!tx) {
      return false;
    }

    return tx.bridge === 'connext' || tx.bridge === 'cbridge';
  },

  getTx(nonce) {
    return this._queue[nonce];
  },

  async getAllTxHistory() {
    // TODO: Implement Hop TxHistory

    const nxtpQueue = Nxtp.getAllHistoricalTxs();
    const cBridgeQueue = await CBridgeUtils.getTxHistory();

    this.buildGenericTxHistory(nxtpQueue, 'connext');
    this.buildGenericTxHistory(cBridgeQueue, 'cbridge');

    return this._genericTxHistory;
  },

  buildGenericTxHistory(bridgeTxHistory, bridge) {
    // TODO: Implement Hop TxHistory

    if (bridge === 'connext') {
      const genericTxHistoryNxtp = mappingToGenerateConnextArray({
        array: bridgeTxHistory,
      });

      this._genericTxHistory = genericTxHistoryNxtp;
    } else {
      const genericTxHistoryCbridge = mappingToGenerateArrayAnyBridge({
        array: bridgeTxHistory,
        bridge,
      });

      this._genericTxHistory = [
        ...this._genericTxHistory,
        ...genericTxHistoryCbridge,
      ];
    }
  },

  async getAllActiveTxs() {
    const NON_ACTIVE_STATUS_CBRIDGE = [0, 2, 5, 10];

    const nxtpActiveTxs = mappingToGenerateConnextArray({
      array: Nxtp.getAllActiveTxs(),
    });

    const cbridgeAllTxs = await CBridgeUtils.getTxHistory();

    const cbridgeActiveTxs = cbridgeAllTxs.filter(
      (tx) => !NON_ACTIVE_STATUS_CBRIDGE.includes(tx.status),
    );

    const cbridgeActiveTxsFormatted = mappingToGenerateArrayAnyBridge({
      array: cbridgeActiveTxs,
      bridge: 'cbridge',
    });

    return [...cbridgeActiveTxsFormatted, ...nxtpActiveTxs];
  },
};

const handleFinishActionOfActiveTx = {
  cbridge: {
    handleFinishAction: async (txId, estimated, sendingChainId) => {
      await CBridgeUtils.withdrawLiquidity(txId, estimated, sendingChainId);
    },
  },
  connext: {
    handleFinishAction: (txId) => Nxtp.transferStepTwo(txId),
  },
};

export { handleFinishActionOfActiveTx };
