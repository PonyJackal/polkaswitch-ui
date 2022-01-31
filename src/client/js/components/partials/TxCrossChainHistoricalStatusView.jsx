/* eslint-disable react/prop-types */

import React from 'react';
import classnames from 'classnames';
import * as ethers from 'ethers';
import numeral from 'numeral';
import dayjs from 'dayjs';

var relativeTime = require('dayjs/plugin/relativeTime')
dayjs.extend(relativeTime)

import TokenListManager from '../../utils/tokenList';

import TxExplorerLink from './TxExplorerLink';

const Utils = ethers.utils;

const TxCrossChainHistoricalStatusView = ({ data: txData }) => {
  if (!txData) {
    return <div />;
  }

  const sendingChain = TokenListManager.getNetworkById(txData.sendingChainId);
  const receivingChain = TokenListManager.getNetworkById(
    txData.receivingChainId,
  );
  const sendingAsset = TokenListManager.findTokenById(
    Utils.getAddress(txData.sendingAssetTokenAddr),
    sendingChain,
  );
  const receivingAsset = TokenListManager.findTokenById(
    Utils.getAddress(txData.receivingAssetTokenAddr),
    receivingChain,
  );

  const input = numeral(
    Utils.formatUnits(txData.sending.amount, sendingAsset.decimals),
  ).format('0.0000a');

  let output;
  let icon;
  let lang;
  let clazz;

  if (txData.receiving?.amount) {
    output = numeral(
      Utils.formatUnits(txData.receiving.amount, receivingAsset.decimals),
    ).format('0.0000a');
  }

  if (txData.status === 'FULFILLED') {
    icon = <ion-icon name="checkmark-circle" />;
    lang = 'SWAPPED';
    clazz = 'success';
  } else {
    icon = <ion-icon name="alert-circle" />;
    lang = 'FAILED';
    clazz = 'failed';
  }

  return (
    <div className={classnames('level is-mobile tx-item tx-history', clazz)}>
      <div className="level-item tx-icon">
        <div className="icon">{icon}</div>
      </div>
      <div className="level-item tx-content">
        <div>
          <div>
            {lang} {input} {sendingAsset.symbol} for {output}{' '}
            {receivingAsset.symbol}
          </div>
          <div>
            {sendingChain.name} &gt; {receivingChain.name}
          </div>
          <div>
            <TxExplorerLink
              chainId={receivingChain.chainId}
              hash={txData.fulfilledTxHash}
            >
              View on Explorer <ion-icon name="open-outline" />
            </TxExplorerLink>
          </div>
          <div className="tx-meta">
            {dayjs(txData.preparedTimestamp * 1000).fromNow()}
            <span className="bridge-selected">
              &nbsp;@&nbsp;
              {txData.bridge === 'cbridge'
                ? 'Celer Bridge'
                : `${txData.bridge} bridge`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TxCrossChainHistoricalStatusView;
