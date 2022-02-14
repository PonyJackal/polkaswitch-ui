import React, { Component } from 'react';
import { CSSTransition } from 'react-transition-group';
import _ from 'underscore';
import classnames from 'classnames';
import * as Sentry from '@sentry/react';
import SwapOrderSlide from './SwapOrderSlide';
import TokenSearchSlide from '../TokenSearchSlide';
import SwapConfirmSlide from './SwapConfirmSlide';
import AdvancedSettingsSlide from '../AdvancedSettingsSlide';
import SwapFinalResultSlide from './SwapFinalResultSlide';
import Wallet from '../../../utils/wallet';
import TokenListManager from '../../../utils/tokenList';
import GlobalStateManager from '../../../utils/global';
import Metrics from '../../../utils/metrics';
import EventManager from '../../../utils/events';
import { ApprovalState } from '../../../constants/Status';

export default class SwapWidget extends Component {
  constructor(props) {
    super(props);
    this.box = React.createRef();
    this.orderPage = React.createRef();
    const network = TokenListManager.getCurrentNetworkConfig();
    const swapConfig = GlobalStateManager.getSwapConfig()

    var mergeState = {};
    mergeState = _.extend(mergeState, {
      toChain: network,
      fromChain: network,
      to: TokenListManager.findTokenById(swapConfig?.to?.address || network.defaultPair.to),
      from: TokenListManager.findTokenById(swapConfig?.from?.address || network.defaultPair.from),
    });

    this.state = _.extend(mergeState, {
      fromAmount: undefined,
      toAmount: undefined,
      availableBalance: undefined,
      swapDistribution: undefined,
      approveStatus: ApprovalState.UNKNOWN,
      searchTarget: '',
      showSettings: false,
      showConfirm: false,
      showSearch: false,
      showResults: false,
      loading: false,
      transactionHash: '',
      refresh: Date.now(),
    });

    this.subscribers = [];
    this.onSwapTokens = this.onSwapTokens.bind(this);
    this.handleTokenChange = this.handleTokenChange.bind(this);
    this.handleSearchToggle = this.handleSearchToggle.bind(this);
    this.handleSettingsToggle = this.handleSettingsToggle.bind(this);
    this.handleConfirm = this.handleConfirm.bind(this);
    this.handleResults = this.handleResults.bind(this);
    this.handleBackOnConfirm = this.handleBackOnConfirm.bind(this);
    this.handleBackOnResults = this.handleBackOnResults.bind(this);
    this.triggerHeightResize = this.triggerHeightResize.bind(this);
    this.updateBoxHeight = _.debounce(this.updateBoxHeight.bind(this), 20);
    this.handleWalletChange = this.handleWalletChange.bind(this);
    this.handleNetworkChange = this.handleNetworkChange.bind(this);
    this.handleNetworkPreUpdate = this.handleNetworkPreUpdate.bind(this);
    this.onSwapEstimateComplete = this.onSwapEstimateComplete.bind(this);
    this.onApproveComplete = this.onApproveComplete.bind(this);
  }

  componentDidMount() {
    this.subscribers.push(
      EventManager.listenFor('walletUpdated', this.handleWalletChange),
    );
    this.subscribers.push(
      EventManager.listenFor('networkUpdated', this.handleNetworkChange),
    );
    this.subscribers.push(
      EventManager.listenFor(
        'networkPendingUpdate',
        this.handleNetworkPreUpdate,
      ),
    );
    this.subscribers.push(
      EventManager.listenFor('txQueueUpdated', this.handleWalletChange),
    );
    window.addEventListener('resize', this.updateBoxHeight);
    this.updateBoxHeight();

    // trigger a network change if needed, if current network is not supported.
    // 'networkUpdated' event will be triggered.
    Wallet.changeNetworkForSwapOrBridge(true);
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.updateBoxHeight);
    this.subscribers.forEach(function (v) {
      EventManager.unsubscribe(v);
    });
  }

  handleNetworkPreUpdate(e) {
    this.setState({
      loading: true,
    });
  }

  handleNetworkChange(e) {
    const network = TokenListManager.getCurrentNetworkConfig();
    const defaultTo = TokenListManager.findTokenById(network.defaultPair.to);
    const defaultFrom = TokenListManager.findTokenById(network.defaultPair.from);
    GlobalStateManager.updateSwapConfig({
      to: defaultTo,
      from: defaultFrom,
      toChain: network.name,
      fromChain: network.name
    });
    this.setState({
      loading: false,
      crossChainEnabled: false,
      to: defaultTo,
      from: defaultFrom,
      toChain: network,
      fromChain: network,
      showSettings: false,
      showConfirm: false,
      showSearch: false,
      showResults: false,
      availableBalance: undefined,
    });
  }

  handleWalletChange(e) {
    this.setState({
      refresh: Date.now(),
    });
  }

  updateBoxHeight() {
    this.box.current.style.height = '';
    _.defer(
      function () {
        console.log(
          '## current offsetHeight ###',
          this.box.current.offsetHeight,
        );
        this.box.current.style.height = `${this.box.current.offsetHeight}px`;
      }.bind(this),
    );
  }

  triggerHeightResize(node, isAppearing) {
    console.log('## offsetHeight ###', node.offsetHeight);
    this.box.current.style.height = `${node.offsetHeight}px`;
  }

  onSwapEstimateComplete(
    fromAmount,
    toAmount,
    dist,
    availBalBN,
    approveStatus,
  ) {
    if (
      this.state.fromAmount === fromAmount &&
      this.state.availableBalance === availBalBN &&
      this.state.toAmount === toAmount
    ) {
      return;
    }

    this.box.current.style.height = '';
    this.setState(
      {
        fromAmount: fromAmount,
        toAmount: toAmount,
        swapDistribution: dist,
        availableBalance: availBalBN,
        approveStatus: approveStatus,
      },
      function () {
        _.delay(
          function () {
            // put back height after dist expand anim
            this.updateBoxHeight();
          }.bind(this),
          301,
        );
      }.bind(this),
    );
  }

  onApproveComplete(approveStatus) {
    if (this.state.approveStatus === approveStatus) {
      return;
    }
    this.setState({
      approveStatus: approveStatus,
    });
  }

  onSwapTokens() {
    Sentry.addBreadcrumb({
      message: 'Action: Swap Tokens',
    });
    Metrics.track('swap-flipped-tokens');
    GlobalStateManager.updateSwapConfig({
      to: this.state.from,
      from: this.state.to,
    });
    this.setState(
      {
        to: this.state.from,
        fromAmount: this.state.toAmount
          ? SwapFn.validateEthValue(this.state.to, this.state.toAmount)
          : undefined,
        from: this.state.to,
        toChain: this.state.fromChain,
        fromChain: this.state.toChain,
        availableBalance: undefined,
        toAmount: undefined,
        refresh: Date.now(),
        // make it easy coming from token-selection
        showSearch: false,
      },
      () => {},
    );
  }

  handleSearchToggle(target) {
    return function (e) {
      Sentry.addBreadcrumb({
        message: 'Page: Search Token: ' + target,
      });

      Metrics.track('swap-search-view', { closing: this.state.showSearch });
      this.setState({
        searchTarget: target,
        showSearch: !this.state.showSearch,
      });
    }.bind(this);
  }

  handleSettingsToggle(e) {
    Sentry.addBreadcrumb({
      message: 'Page: Settings',
    });

    Metrics.track('swap-settings-view', { closing: this.state.showSettings });
    this.setState({
      showSettings: !this.state.showSettings,
    });
  }

  handleConfirm(e) {
    Sentry.addBreadcrumb({
      message: 'Page: Review',
      data: {
        to: this.state.to,
        from: this.state.from,
        fromAmount: this.state.fromAmount,
        toAmount: this.state.toAmount,
      },
    });

    Metrics.track('swap-review-step', { closing: this.state.showConfirm });
    this.setState({
      showConfirm: true,
    });
  }

  handleResults(success, hash) {
    EventManager.emitEvent('networkHoverableUpdated', { hoverable: true });
    this.setState({
      transactionHash: hash,
      showConfirm: false,
      showResults: true,
      transactionSuccess: success,
      refresh: Date.now(), // refresh Balances
    });
  }

  handleBackOnConfirm(e) {
    EventManager.emitEvent('networkHoverableUpdated', { hoverable: true });
    this.setState({ showConfirm: false });
  }

  handleBackOnResults(e) {
    EventManager.emitEvent('networkHoverableUpdated', { hoverable: true });
    this.setState({
      showConfirm: false,
      showResults: false,
      toAmount: '',
      fromAmount: '',
      swapDistribution: undefined,
      refresh: Date.now(), // refresh Balances
    });
  }

  handleTokenChange(token) {
    var alt = this.state.searchTarget === 'from' ? 'to' : 'from';
    // if you select the same token pair, do a swap instead
    if (this.state[alt] && this.state[alt].address && this.state[alt].address === token.address) {
      return this.onSwapTokens();
    }

    var _s = {
      showSearch: false,
      availableBalance: undefined,
      refresh: Date.now(),
    };

    _s[this.state.searchTarget] = token;

    if (this.state.searchTarget === 'from') {
      _s['fromAmount'] = SwapFn.validateEthValue(token, this.state.fromAmount);
    }

    GlobalStateManager.updateSwapConfig({ [this.state.searchTarget]: token });
    this.setState(
      _s,
      function () {
        Metrics.track('swap-token-changed', {
          changed: this.state.searchTarget,
          from: this.state.from,
          to: this.state.to,
        });
      }.bind(this),
    );
  }

  render() {
    var animTiming = 300;
    var isStack = !(
      this.state.showSettings ||
      this.state.showConfirm ||
      this.state.showSearch ||
      this.state.showResults
    );

    return (
      <div ref={this.box} className="box swap-widget">
        <div
          className={classnames('loader-wrapper', {
            'is-active': this.state.loading,
          })}
        >
          <div className="loader is-loading"></div>
        </div>
        <CSSTransition
          in={isStack}
          timeout={animTiming}
          onEntering={this.triggerHeightResize}
          classNames="fade"
        >
          <SwapOrderSlide
            ref={this.orderPage}
            toChain={this.state.toChain}
            fromChain={this.state.fromChain}
            to={this.state.to}
            from={this.state.from}
            fromAmount={this.state.fromAmount}
            toAmount={this.state.toAmount}
            availableBalance={this.state.availableBalance}
            approveStatus={this.state.approveStatus}
            refresh={this.state.refresh}
            handleSearchToggle={this.handleSearchToggle}
            handleSettingsToggle={this.handleSettingsToggle}
            swapDistribution={this.state.swapDistribution}
            onSwapEstimateComplete={this.onSwapEstimateComplete}
            onSwapTokens={this.onSwapTokens}
            handleSubmit={this.handleConfirm}
          />
        </CSSTransition>
        <CSSTransition
          in={this.state.showSearch}
          timeout={animTiming}
          onEntering={this.triggerHeightResize}
          classNames="slidein"
        >
          <TokenSearchSlide
            isCrossChain={false}
            isFrom={this.state.searchTarget === 'from'}
            network={
              this.state.searchTarget === 'to'
                ? this.state.toChain
                : this.state.fromChain
            }
            showSearch={this.state.showSearch}
            handleSearchToggle={this.handleSearchToggle}
            handleTokenChange={this.handleTokenChange}
          />
        </CSSTransition>
        <CSSTransition
          in={this.state.showSettings}
          timeout={animTiming}
          onEntering={this.triggerHeightResize}
          classNames="slidein"
        >
          <AdvancedSettingsSlide
            handleBackOnSettings={this.handleSettingsToggle}
          />
        </CSSTransition>
        <CSSTransition
          in={this.state.showConfirm || this.state.showResults}
          timeout={animTiming}
          onEntering={this.triggerHeightResize}
          classNames="slidein"
        >
          <CSSTransition
            in={!this.state.showResults}
            timeout={animTiming}
            classNames="fade"
          >
            <SwapConfirmSlide
              to={this.state.to}
              from={this.state.from}
              fromAmount={this.state.fromAmount}
              toAmount={this.state.toAmount}
              availableBalance={this.state.availableBalance}
              approveStatus={this.state.approveStatus}
              refresh={this.state.refresh}
              swapDistribution={this.state.swapDistribution}
              handleTransactionComplete={this.handleResults}
              onApproveComplete={this.onApproveComplete}
              handleBackOnConfirm={this.handleBackOnConfirm}
            />
          </CSSTransition>
        </CSSTransition>
        <CSSTransition
          in={this.state.showResults}
          timeout={animTiming}
          onEntering={this.triggerHeightResize}
          classNames="slidein"
        >
          <SwapFinalResultSlide
            to={this.state.to}
            from={this.state.from}
            toChain={this.state.toChain}
            fromChain={this.state.fromChain}
            fromAmount={this.state.fromAmount}
            toAmount={this.state.toAmount}
            transactionSuccess={this.state.transactionSuccess}
            transactionHash={this.state.transactionHash}
            handleDismiss={this.handleBackOnResults}
          />
        </CSSTransition>
      </div>
    );
  }
}
