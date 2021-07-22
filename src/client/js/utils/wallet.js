
import _ from "underscore";
import EventManager from './events';
import * as ethers from 'ethers';
import TokenListManager from './tokenList';
import BN from 'bignumber.js';

import WalletConnectProvider from "@walletconnect/web3-provider";

const BigNumber = ethers.BigNumber;
const Utils = ethers.utils;
const Contract = ethers.Contract;

window.WalletJS = {
  _cachedWeb3Provider: undefined,
  _cachedCurrentAddress: undefined,
  _cachedNetworkId: -1,
  _cachedStrategy: undefined,

  providerConfigs: {
    'walletConnect': {
    }
  },

  initialize: async function() {
    // initialize MetaMask if already connected
    if (window.ethereum) {
      this.initListeners(window.ethereum);

      if (window.ethereum.selectedAddress) {
        var web3Provider = new ethers.providers.Web3Provider(window.ethereum);
        await this._saveConnection(web3Provider, "metamask");
      }
    }

    else if (false) {
      // TODO init WalletConnect
    }

    window.erc20Abi = await (await fetch('/abi/erc20_standard.json')).json();
    window.oneSplitAbi = await (await fetch('/abi/test/OneSplit.json')).json();

    EventManager.listenFor(
      'initiateWalletConnect',
      this._connectWalletHandler.bind(this)
    );
  },

  initListeners: function(provider) {
    provider.on('accountsChanged', function (accounts) {
      // Time to reload your interface with accounts[0]!
      if (accounts[0] != this.currentAddress() && this._cachedWeb3Provider) {
        this._saveConnection(this._cachedWeb3Provider, this._cachedStrategy);
      }
    }.bind(this));

    provider.on('disconnect', function(providerRpcError) {
      this.disconnect();
      EventManager.emitEvent('walletUpdated', 1);
    }.bind(this));

    provider.on('chainChanged', function(chainId) {
      if (this.isConnectedToAnyNetwork()) {
        this._saveConnection(this._cachedWeb3Provider, this._cachedStrategy);
      }
    }.bind(this));
  },

  getReadOnlyProvider: function() {
    var network = TokenListManager.getCurrentNetworkConfig();
    const provider = new ethers.providers.JsonRpcProvider(network.nodeProvider);
    return provider;
  },

  getProvider: function(strictCheck) {
    var condition = strictCheck ? this.isConnected() : this.isConnectedToAnyNetwork();

    if (condition) {
      return this._cachedWeb3Provider;
    } else {
      return this.getReadOnlyProvider();
    }
  },

  getBalance: function(token) {
    if (this.isConnected()) {
      if (token.native) {
        return this.getDefaultBalance();
      }

      else if (token.address) {
        return this.getERC20Balance(token.address);
      }
    } else {
      return Promise.resolve(BigNumber.from(0));
    }
  },

  getDefaultBalance: function() {
    return this.getProvider().getBalance(this.currentAddress());
  },

  getERC20Balance: async function(tokenContractAddress) {
    const contract = new Contract(
      tokenContractAddress,
      window.erc20Abi,
      this.getProvider()
    );
    return await contract.balanceOf(this.currentAddress());
  },

  getName: function(tokenAddr) {
    if (this.isConnected() && tokenAddr) {
      return this.getERC20Name(tokenAddr);
    } else {
      return Promise.resolve('');
    }
  },

  getERC20Name: async function(tokenContractAddress) {
    const contract = new Contract(
        tokenContractAddress,
        window.erc20Abi,
        this.getProvider()
    );
    return await contract.name();
  },

  getDecimals: function(tokenAddr) {
    if (this.isConnected() && tokenAddr) {
      return this.getERC20Decimals(tokenAddr);
    } else {
      return Promise.reject();
    }
  },

  getERC20Decimals: async function(tokenContractAddress) {
    const contract = new Contract(
        tokenContractAddress,
        window.erc20Abi,
        this.getProvider()
    );
    return await contract.decimals();
  },

  getSymbol: function(tokenAddr) {
    if (this.isConnected() && tokenAddr) {
      return this.getERC20Symbol(tokenAddr);
    } else {
      return Promise.reject();
    }
  },

  getERC20Symbol: async function(tokenContractAddress) {
    const contract = new Contract(
        tokenContractAddress,
        window.erc20Abi,
        this.getProvider()
    );
    return await contract.symbol();
  },

  isMetamaskSupported: function() {
    return (typeof window.ethereum !== 'undefined');
  },

  _currentConnectedNetworkId: async function() {
    if (!this.isConnectedToAnyNetwork()) {
      return -1;
    }

    else {
      let connectedNetwork = await this.getProvider().getNetwork();
      return connectedNetwork.chainId;
    }
  },

  isConnected: function(strategy) {
    var connected = this.isConnectedToAnyNetwork() &&
      this.isMatchingConnectedNetwork();

    // scope to connection strategy if supplied
    if (strategy) {
      return (strategy == this._cachedStrategy) && connected;
    } else {
      return connected;
    }
  },

  isConnectedToAnyNetwork: function() {
    return !!this._cachedWeb3Provider;
  },

  isMatchingConnectedNetwork: function() {
    var network = TokenListManager.getCurrentNetworkConfig();
    return +network.chainId === +this._cachedNetworkId;
  },

  currentAddress: function() {
    if (this.isConnectedToAnyNetwork()) {
      return this._cachedCurrentAddress;
    } else {
      return undefined;
    }
  },

  disconnect: function() {
    this._cachedCurrentAddress = undefined;
    this._cachedNetworkId = -1;
    this._cachedStrategy = undefined;
    this._cachedWeb3Provider = undefined;
    EventManager.emitEvent('walletUpdated', 1);
  },

  _connectWalletHandler: function(target) {
    if (target === "metamask") {
      this._connectProviderMetamask();
    } else if (target === "walletConnect") {
      this._connectProviderWalletConnect();
    }
  },

  _saveConnection: async function(provider, strategy) {
    let connectedNetwork = await provider.getNetwork();
    let address = await provider.listAccounts();
    let chainId = connectedNetwork.chainId;

    this._cachedCurrentAddress = address[0];
    this._cachedNetworkId = chainId;
    this._cachedStrategy = strategy;
    this._cachedWeb3Provider = provider;

    EventManager.emitEvent('walletUpdated', 1);
  },

  _connectProviderWalletConnect: function() {
    let network = TokenListManager.getCurrentNetworkConfig();

    const provider = new WalletConnectProvider({
      rpc: {
        137: "https://rpc-mainnet.maticvigil.com"
      },
      chainId: 137
    });

    provider.enable().then(function(v) {
      var web3Provider = new ethers.providers.Web3Provider(provider);

      return this._saveConnection(web3Provider, "walletConnect");
    }.bind(this)).catch(function(e) {
      console.error(e);
    });

    this.initListeners(provider);
  },

  _connectProviderMetamask: function() {
    return new Promise(function (resolve, reject) {
      let network = TokenListManager.getCurrentNetworkConfig();

      window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [network.chain]
      }).then(function() {
        _.delay(function() {
          window.ethereum.request({ method: 'eth_requestAccounts' })
            .then(function(accounts) {
              // Metamask currently only ever provide a single account
              const account = accounts[0];

              var web3Provider = new ethers.providers.Web3Provider(window.ethereum);
              return this._saveConnection(web3Provider, "metamask").then(function() {
                resolve(account);
              });
            }.bind(this))
            .catch(function(e) {
              console.error(e);
              reject(e);
            });
        }.bind(this), 1000)
      }.bind(this));
    }.bind(this));
  }
};

export default window.WalletJS;

