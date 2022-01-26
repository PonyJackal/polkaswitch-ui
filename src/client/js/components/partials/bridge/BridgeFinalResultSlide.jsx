import React from 'react';
import classnames from 'classnames';
import TxExplorerLink from '../TxExplorerLink';

const BridgeFinalResultSlide = (props) => (
  <div className="page page-stack page-view-results">
    <div className="page-inner">
      <div className="level is-mobile">
        <div className="level-left">
          <div className="level-item">
            <span
              className="icon ion-icon clickable"
              onClick={props.handleDismiss}
            >
              <ion-icon name="arrow-back-outline" />
            </span>
          </div>
        </div>
      </div>

      <div
        className={classnames('centered-view', {
          failed: !props.transactionSuccess,
        })}
      >
        <div className="icon">
          {props.transactionSuccess ? (
            <ion-icon name="rocket-outline" />
          ) : (
            <ion-icon name="alert-circle-outline" />
          )}
        </div>
        <div className="title">
          {props.transactionSuccess
            ? 'Transaction Submitted'
            : 'Transaction Failed'}
        </div>
        <div className="details">
          <div>
            {props.transactionSuccess && (
              <div>
                <div>
                  Sent to the blockchain and pending confirmation.
                  <br />
                  Check notifications drawer for more updates.
                </div>

                <br />
                <TxExplorerLink
                  network={props.toChain}
                  hash={props.transactionHash}
                >
                  View on Explorer <ion-icon name="open-outline" />
                </TxExplorerLink>
              </div>
            )}
            {!props.transactionSuccess && <div>Please try again</div>}
          </div>
        </div>
      </div>

      <div>
        <button
          className="button is-primary is-fullwidth is-medium"
          onClick={props.handleDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  </div>
);

export default BridgeFinalResultSlide;
