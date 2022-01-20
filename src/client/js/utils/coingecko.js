import Storage from './storage';

export default {
  _baseURL: 'https://api.coingecko.com/api/v3',

  fetchData: async function (url) {
    let result = null;

    try {
      const response = await fetch(`${this._baseURL}/${url}`);
      if (response.ok) {
        const data = await response.json();
        if (data) {
          result = data;
        }
      }
      return result;
    } catch (err) {
      console.log(
        'Failed to get coin with contract address from coingecko service.',
        err,
      );
    }
  },

  getCoinsFromContract: async function (network, address) {
    const url = `coins/${network}/contract/${address.toLowerCase()}`;
    return await this.fetchData(url);
  },

  fetchLinePrices: async function (url) {
    const data = await this.fetchData(`coins/${url}`);
    if (data && data.prices) {
      return data.prices;
    } else {
      return [];
    }
  },

  fetchCandleStickPrices: async function (url) {
    const data = await this.fetchData(`coins/${url}`);
    if (data) {
      return data;
    } else {
      return [];
    }
  },

  getLogoURL: async function (network, address) {
    // check cached token logo urls at the first time.
    const imageUrl = Storage.getCachedTokenLogoUrl(address);
    if (imageUrl) {
      return imageUrl;
    }

    // fetch info from coingecko service.
    const data = await this.getCoinsFromContract(network, address);
    if (data && data.image && data.image.small) {
      Storage.updateCachedTokenLogoUrl(address, data.image.small);
      return data.image.small;
    } else {
      return null;
    }
  },
  // fetch available chains from coingecko
  fetchAssetPlatforms: async function () {
    const data = await this.fetchData(`asset_platforms`);
    if (data) {
      return data;
    } else {
      return [];
    }
  },
  fetchTokens: async function (chainId) {
    const data = await this.fetchData(
      `coins/list?include_platform=true&include_symbol=true&asset_platform_id=${chainId}`,
    );
    if (data) {
      return data;
    } else {
      return [];
    }
  },
  fetchTokenList: async function (chainId) {
    const assetPlatforms = await this.fetchAssetPlatforms();

    const chainData = assetPlatforms.find(
      (chain) => chain.chain_identifier === chainId,
    );

    if (!chainData) {
      return [];
    }

    const tokens = await this.fetchTokens(chainData.id);

    return tokens;
  },
};
