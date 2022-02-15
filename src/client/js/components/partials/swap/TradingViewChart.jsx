import React, { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import {
  ResponsiveContainer, AreaChart, Area, Tooltip, XAxis, YAxis
} from 'recharts';
import BN from 'bignumber.js';
import dayjs from 'dayjs';
import TokenPairSelector from './TokenPairSelector';
import ChartPriceDetails from './ChartPriceDetails';
import ChartViewOption from './ChartViewOption';
import ChartRangeSelector from './ChartRangeSelector';
import EventManager from '../../../utils/events';
import TokenListManager from '../../../utils/tokenList';
import CoingeckoManager from '../../../utils/coingecko';
import { wrapTokens } from '../../../constants';

export default function TradingViewChart() {
  const DECIMAL_PLACES = 4;
  const timeRangeList = {
    candlestick: [
      { name: '1D', value: 1, from: 'Past 1 day' },
      { name: '1W', value: 7, from: 'Past week' },
      { name: '2W', value: 14, from: 'Past 2 weeks' },
      { name: '1M', value: 30, from: 'Past month' },
    ],
    line: [
      { name: '1D', from: 'Past 1 day' },
      { name: '3D', from: 'Past 3 days' },
      { name: '1W', from: 'Past week' },
      { name: '1M', from: 'Past month' },
      { name: '1Y', from: 'Past year' },
    ],
  };

  const viewModes = ['candlestick', 'line'];
  const candleChartContainerRef = useRef();
  const chart = useRef();
  const createTokenPairList = () => {
    const swapConfig = GlobalStateManager.getSwapConfig();
    const list = [];
    const fromSymbol = swapConfig.from.symbol;
    const fromAddress = swapConfig.from.address;
    const { fromChain } = swapConfig;
    const fromTokenLogo = swapConfig.from.logoURI;
    const toSymbol = swapConfig.to.symbol;
    const toAddress = swapConfig.to.address;
    const { toChain } = swapConfig;
    const toTokenLogo = swapConfig.to.logoURI;

    list.push({
      name: `${fromSymbol}/${toSymbol}`,
      fromSymbol,
      fromAddress,
      fromTokenLogo,
      toSymbol,
      toAddress,
      toTokenLogo,
      fromChain,
      toChain
    });
    list.push({
      name: `${toSymbol}/${fromSymbol}`,
      fromSymbol: toSymbol,
      fromAddress: toAddress,
      fromTokenLogo: toTokenLogo,
      fromChain: toChain,
      toSymbol: fromSymbol,
      toAddress: fromAddress,
      toTokenLogo: fromTokenLogo,
      toChain: fromChain
    });
    list.push({
      name: fromSymbol,
      fromSymbol,
      fromAddress,
      fromTokenLogo,
      fromChain,
    });
    list.push({
      name: toSymbol,
      fromSymbol: toSymbol,
      fromAddress: toAddress,
      fromTokenLogo: toTokenLogo,
      fromChain: toChain
    });
    return list;
  };
  const candleSeries = useRef(null);
  // init states
  const initTokenPair = createTokenPairList();
  const [isLoading, setIsLoading] = useState(false);
  const [tokenPairs, setTokenPairs] = useState(initTokenPair);
  const [selectedPair, setSelectedPair] = useState(
    initTokenPair[0] || undefined,
  );
  const [selectedViewMode, setSelectedViewMode] = useState(viewModes[1]);
  const [selectedTimeRange, setSelectedTimeRange] = useState(
    timeRangeList.line[0],
  );
  const [isPair, setIsPair] = useState(true);
  const [priceDetails, setPriceDetails] = useState({
    price: 0,
    percent: 0,
    from: timeRangeList.line[0].from,
  });
  const [tokenPriceData, setTokenPriceData] = useState([]);

  const handleSwapConfigChange = () => {
    const updatedTokenPairList = createTokenPairList();
    setTokenPairs(updatedTokenPairList);
    setSelectedPair(updatedTokenPairList[0]);
    setIsPair(true);
  };

  const getTimestamps = (timeRange) => {
    let fromTimestamp = Date.now();
    const toTimestamp = Math.ceil(Date.now() / 1000);
    const currentDate = new Date();
    switch (timeRange.name) {
      case '1D':
        currentDate.setDate(currentDate.getDate() - 1);
        break;
      case '3D':
        currentDate.setDate(currentDate.getDate() - 3);
        break;
      case '1W':
        currentDate.setDate(currentDate.getDate() - 7);
        break;
      case '1M':
        currentDate.setMonth(currentDate.getMonth() - 1);
        break;
      case '1Y':
        currentDate.setFullYear(currentDate.getFullYear() - 1);
        break;
      default:
        break;
    }

    fromTimestamp = Math.ceil(currentDate.getTime() / 1000);
    return { fromTimestamp, toTimestamp };
  };

  const getFilteredTimestamp = (timestampMillisec) => {
    const timestampSec = (timestampMillisec - (timestampMillisec % 1000)) / 1000;
    return timestampSec - (timestampSec % 60);
  };

  const getContractAddress = async (contract, symbol, platform, chainId) => {
    if (wrapTokens.hasOwnProperty(symbol)) {
      return wrapTokens[symbol][chainId];
    }
    const coin = await TokenListManager.findTokenBySymbolFromCoinGecko(
      symbol.toLowerCase(),
    );
    if (coin && coin.platforms.hasOwnProperty(platform)) {
      return coin.platforms[platform];
    }
    return contract;
  };

  const fetchLinePrices = async (
    platform,
    contract,
    currency,
    fromTimestamp,
    toTimestamp,
    attempt,
  ) => {
    let result = [];
    if (!attempt) {
      attempt = 0;
    } else if (attempt > 1) {
      return result;
    }
    try {
      const url = `${platform}/contract/${contract.toLowerCase()}/market_chart/range?vs_currency=${currency}&from=${fromTimestamp}&to=${toTimestamp}`;
      result = await CoingeckoManager.fetchLinePrices(url);
      return result;
    } catch (err) {
      console.error('Failed to fetch price data', err);
      await fetchLinePrices(
        platform,
        contract,
        currency,
        fromTimestamp,
        toTimestamp,
        attempt + 1,
      );
    }
  };

  const mergeLinePrices = (fromTokenPrices, toTokenPrices) => {
    const prices = [];
    if (
      fromTokenPrices
      && toTokenPrices
      && fromTokenPrices.length > 0
      && toTokenPrices.length > 0
    ) {
      if (fromTokenPrices.length === toTokenPrices.length) {
        for (let i = 0; i < fromTokenPrices.length; i++) {
          prices.push({
            time: getFilteredTimestamp(fromTokenPrices[i][0]),
            value: parseFloat(BN(fromTokenPrices[i][1])
              .div(toTokenPrices[i][1])
              .toFixed(DECIMAL_PLACES)),
          });
        }
      } else {
        const tempObj = {};
        for (let i = 0; i < fromTokenPrices.length; i++) {
          tempObj[getFilteredTimestamp(fromTokenPrices[i][0])] = fromTokenPrices[i];
        }

        for (let j = 0; j < toTokenPrices.length; j++) {
          const timeStampOfTotoken = getFilteredTimestamp(toTokenPrices[j][0]);
          if (tempObj.hasOwnProperty(timeStampOfTotoken)) {
            const fromTokenItem = tempObj[timeStampOfTotoken];
            tempObj[timeStampOfTotoken] = {
              time: timeStampOfTotoken,
              value: parseFloat(BN(fromTokenItem[1])
                .div(toTokenPrices[j][1])
                .toFixed(DECIMAL_PLACES)),
            };
          }
        }

        for (const property in tempObj) {
          if (!Array.isArray(tempObj[property])) {
            prices.push(tempObj[property]);
          }
        }
      }
    } else if (
      fromTokenPrices
      && fromTokenPrices.length > 0
      && toTokenPrices === null
    ) {
      for (let i = 0; i < fromTokenPrices.length; i++) {
        prices.push({
          time: getFilteredTimestamp(fromTokenPrices[i][0]),
          value: parseFloat(BN(fromTokenPrices[i][1]).toFixed(DECIMAL_PLACES)),
        });
      }
    }
    return prices;
  };

  const fetchCandleStickPrices = async (coinId, currency, days, attempt) => {
    let result = [];
    if (!attempt) {
      attempt = 0;
    } else if (attempt > 1) {
      return result;
    }
    try {
      const url = `${coinId}/ohlc?vs_currency=${currency}&days=${days}`;
      result = await CoingeckoManager.fetchCandleStickPrices(url);
      return result;
    } catch (err) {
      console.error('Failed to fetch price data', err);
      await fetchCandleStickPrices(coinId, currency, days, attempt + 1);
    }
  };

  const mergeCandleStickPrices = (fromTokenPrices, toTokenPrices) => {
    const prices = [];
    if (
      fromTokenPrices
      && toTokenPrices
      && fromTokenPrices.length > 0
      && toTokenPrices.length > 0
    ) {
      const tempObj = {};
      for (let i = 0; i < fromTokenPrices.length; i++) {
        tempObj[getFilteredTimestamp(fromTokenPrices[i][0])] = fromTokenPrices[i];
      }

      for (let j = 0; j < toTokenPrices.length; j++) {
        const timeStampOfTotoken = getFilteredTimestamp(toTokenPrices[j][0]);
        if (tempObj.hasOwnProperty(timeStampOfTotoken)) {
          const fromTokenItem = tempObj[timeStampOfTotoken];
          tempObj[timeStampOfTotoken] = {
            time: timeStampOfTotoken,
            open: parseFloat(BN(fromTokenItem[1]).div(toTokenPrices[j][1]).toFixed(DECIMAL_PLACES)),
            high: parseFloat(BN(fromTokenItem[2]).div(toTokenPrices[j][2]).toFixed(DECIMAL_PLACES)),
            low: parseFloat(BN(fromTokenItem[3]).div(toTokenPrices[j][3]).toFixed(DECIMAL_PLACES)),
            close: parseFloat(BN(fromTokenItem[4]).div(toTokenPrices[j][4]).toFixed(DECIMAL_PLACES))
          };
        }
      }

      for (const property in tempObj) {
        if (!Array.isArray(tempObj[property])) {
          prices.push(tempObj[property]);
        }
      }
    } else if (fromTokenPrices.length > 0 && toTokenPrices === null) {
      for (let i = 0; i < fromTokenPrices.length; i++) {
        prices.push({
          time: getFilteredTimestamp(fromTokenPrices[i][0]),
          open: parseFloat(BN(fromTokenPrices[i][1]).toFixed(DECIMAL_PLACES)),
          high: parseFloat(BN(fromTokenPrices[i][2]).toFixed(DECIMAL_PLACES)),
          low: parseFloat(BN(fromTokenPrices[i][3]).toFixed(DECIMAL_PLACES)),
          close: parseFloat(BN(fromTokenPrices[i][4]).toFixed(DECIMAL_PLACES)),
        });
      }
    }
    return prices;
  };

  const getPriceDetails = (prices, viewMode) => {
    const { length } = prices;
    let price = 0;
    let percent = 0;
    const firstItem = prices[0];
    const lastItem = prices[length - 1];

    if (viewMode === 'line') {
      percent = new BN(lastItem.value)
        .div(new BN(firstItem.value))
        .times(100)
        .minus(100)
        .toFixed(2);
      price = lastItem.value;
    } else {
      percent = new BN(lastItem.open)
        .div(new BN(firstItem.open))
        .times(100)
        .minus(100)
        .toFixed(2);
      price = lastItem.open;
    }

    return { price, percent };
  };

  const fetchData = async (pair, timeRange, viewMode) => {
    let fromTokenPrices = [];
    let toTokenPrices = [];
    let tokenPrices = [];

    setIsLoading(true);

    const fromChain = TokenListManager.getNetworkByName(pair.fromChain);
    const toChain = TokenListManager.getNetworkByName(pair.toChain);

    if (viewMode === 'line') {
      const { fromTimestamp, toTimestamp } = getTimestamps(timeRange);
      const platformOfFromChain = fromChain.coingecko.platform;
      const chainIdOfFromChain = fromChain.chainId;

      if (pair.fromSymbol && pair.toSymbol) {
        const platformOfToChain = toChain.coingecko.platform;
        const chainIdOfToChain = toChain.chainId;
        const fromAddress = await getContractAddress(
          pair.fromAddress,
          pair.fromSymbol,
          platformOfFromChain,
          chainIdOfFromChain
        );
        const toAddress = await getContractAddress(
          pair.toAddress,
          pair.toSymbol,
          platformOfToChain,
          chainIdOfToChain
        );

        fromTokenPrices = await fetchLinePrices(
          platformOfFromChain,
          fromAddress,
          'usd',
          fromTimestamp,
          toTimestamp,
        );
        toTokenPrices = (await fetchLinePrices(
          platformOfToChain,
          toAddress,
          'usd',
          fromTimestamp,
          toTimestamp,
        )) || [];
        tokenPrices = mergeLinePrices(fromTokenPrices, toTokenPrices);
      } else {
        const fromAddress = await getContractAddress(
          pair.fromAddress,
          pair.fromSymbol,
          platformOfFromChain,
          chainIdOfFromChain
        );

        fromTokenPrices = await fetchLinePrices(
          platformOfFromChain,
          fromAddress,
          'usd',
          fromTimestamp,
          toTimestamp,
        );
        tokenPrices = mergeLinePrices(fromTokenPrices, null);
      }
    } else if (pair.fromSymbol && pair.toSymbol) {
      const fromCoin = await TokenListManager.findTokenBySymbolFromCoinGecko(
        pair.fromSymbol.toLowerCase(),
      );
      const toCoin = await TokenListManager.findTokenBySymbolFromCoinGecko(
        pair.toSymbol.toLowerCase(),
      );

      if (fromCoin && toCoin) {
        fromTokenPrices = (await fetchCandleStickPrices(
          fromCoin.id,
          'usd',
          timeRange.value,
        )) || [];
        toTokenPrices = (await fetchCandleStickPrices(
          toCoin.id,
          'usd',
          timeRange.value,
        )) || [];
      }

      tokenPrices = mergeCandleStickPrices(fromTokenPrices, toTokenPrices);
    } else {
      const coinId = await TokenListManager.findTokenBySymbolFromCoinGecko(pair.fromSymbol.toLowerCase());
      if (coinId) {
        fromTokenPrices = await fetchCandleStickPrices(coinId.id, 'usd', timeRange.value);
      }
      tokenPrices = mergeCandleStickPrices(fromTokenPrices, null);
    }
    setTimeout(() => {
      setIsLoading(false);
      setTokenPriceData(tokenPrices);
      if (tokenPrices.length > 0) {
        const { price, percent } = getPriceDetails(
          tokenPrices,
          selectedViewMode,
        );
        setPriceDetails({ price, percent, from: selectedTimeRange.from });
      } else {
        setPriceDetails({ price: 0, percent: 0, from: selectedTimeRange.from });
      }
    }, 500);
  };

  const isValidCandleStickDataType = (priceData) => {
    if (priceData.length > 0) {
      const firstItem = priceData[0];
      if (firstItem.hasOwnProperty('open')) {
        return true;
      }
    }
    return false;
  };

  const initCandleStickChart = () => {
    if (chart.current) {
      if (candleSeries.current) {
        chart.current.removeSeries(candleSeries.current);
        candleSeries.current = null;
      }
      chart.current = null;
    }
  };

  const dateFormatter = (item) => dayjs(item * 1000).format('h:mm A MMM. Do z');

  useEffect(() => {
    const subSwapConfigChange = EventManager.listenFor(
      'swapConfigUpdated',
      handleSwapConfigChange,
    );

    return () => {
      subSwapConfigChange.unsubscribe();
      if (chart.current) {
        chart.current.remove();
      }
    };
  }, []);

  // Resize chart on container resizes.
  useEffect(() => {
    if (selectedViewMode === 'candlestick' && candleChartContainerRef.current) {
      const handleResize = (width, height) => {
        chart.current.resize(width, height);
        setTimeout(() => {
          chart.current.timeScale().fitContent();
        }, 0);
      };

      if (candleChartContainerRef.current) {
        window.addEventListener('resize', () => {
          handleResize(
            candleChartContainerRef.current.clientWidth,
            candleChartContainerRef.current.clientHeight,
          );
        });
      }
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }
  }, [candleChartContainerRef.current]);

  // Fetch Data
  useEffect(() => {
    fetchData(selectedPair, selectedTimeRange, selectedViewMode).then(() => {
    });
  }, [selectedPair, selectedTimeRange, selectedViewMode]);

  useEffect(() => {
    if (
      selectedViewMode === 'candlestick'
      && candleChartContainerRef.current
      && isValidCandleStickDataType
    ) {
      initCandleStickChart();
      chart.current = createChart(candleChartContainerRef.current, {
        width: candleChartContainerRef.current.clientWidth,
        height: candleChartContainerRef.current.clientHeight,
        rightPriceScale: {
          visible: false,
        },
        leftPriceScale: {
          visible: true,
        },
        layout: {
          backgroundColor: '#FFFFFF',
          textColor: '#333',
        },
        grid: {
          vertLines: {
            visible: false,
          },
          horzLines: {
            visible: false,
          },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        priceScale: {
          borderColor: '#485c7b',
        },
        timeScale: {
          borderColor: '#485c7b',
          timeVisible: true,
          secondsVisible: true,
        },
      });

      candleSeries.current = chart.current.addCandlestickSeries({
        upColor: '#89c984',
        downColor: '#ff4976',
        borderDownColor: '#ff4976',
        borderUpColor: '#89c984',
        wickDownColor: '#838ca1',
        wickUpColor: '#838ca1',
      });

      candleSeries.current.setData(tokenPriceData);
      chart.current.timeScale().fitContent();
    }
  }, [tokenPriceData]);

  const handleTokenPairChange = (pair) => {
    if (pair && pair.fromSymbol && pair.toSymbol) {
      setIsPair(true);
    } else {
      setIsPair(false);
    }
    setSelectedPair(pair);
  };

  const handleViewModeChange = (mode) => {
    setSelectedTimeRange(timeRangeList[mode][0]);
    setSelectedViewMode(mode);
  };

  const handleRangeChange = (timeRange) => {
    setSelectedTimeRange(timeRange);
  };

  const handleMove = ({ isTooltipActive, activePayload }) => {
    if (isTooltipActive && activePayload.length > 0) {
      setPriceDetails({
        ...priceDetails,
        price:
          (activePayload[0].payload && activePayload[0].payload.value) || 0,
      });
    }
  };

  const handleLeave = () => {
    if (tokenPriceData.length > 0) {
      const { length } = tokenPriceData;
      const lastItem = tokenPriceData[length - 1];
      setPriceDetails({ ...priceDetails, price: lastItem.value || 0 });
    }
  };

  function CustomTooltip({ payload, active }) {
    if (active && payload.length > 0) {
      return (
        <div className="custom-tooltip">
          <p className="text">{dateFormatter(payload[0].payload.time)}</p>
        </div>
      );
    }

    return null;
  }

  const renderTradingChatView = (loading, viewMode, priceData) => {
    if (loading) {
      if (viewMode === 'line') {
        return (
          <span id="trading-chart-loading-bar">
            <img src="/images/chart_line_animate.svg" alt="line chart animate" />
          </span>
        );
      }
      return (
        <span id="trading-chart-loading-bar">
          <img src="/images/chart_cundle_animate.svg" alt="candle chart animate" />
        </span>
      );
    }
    if (priceData.length === 0) {
      return (
        <div className="chart">
          <div>
            <img width={110} height={110} src="/images/no_data.svg" alt="no data" />
          </div>
          <div className="empty-primary-text">No Data</div>
          <div className="empty-sub-text">
            There is no historical data to display for this token.
          </div>
        </div>
      );
    }
    if (viewMode === 'line') {
      return (
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart
            data={priceData}
            stackOffset="monotone"
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
          >
            <defs>
              <linearGradient id="colorUv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="10%" stopColor="#45C581" stopOpacity="0.1" />
                <stop offset="90%" stopColor="#FFFFFF" stopOpacity="0.1" />
              </linearGradient>
            </defs>
            <Tooltip position={{ y: 0 }} content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#89c984"
              strokeWidth={1.5}
              fillOpacity={1}
              fill="url(#colorUv)"
            />
            <YAxis type="number" hide="true" dataKey="value" domain={['dataMin', 'dataMax']} />
            <YAxis type="number" hide="true" dataKey="time" />
          </AreaChart>
        </ResponsiveContainer>
      );
    }
    return <div className="chart" ref={candleChartContainerRef} />;
  };

  return (
    <div>
      <div className="trading-view-header">
        <TokenPairSelector
          tokenPairs={tokenPairs}
          selectedPair={selectedPair}
          handleTokenPairChange={handleTokenPairChange}
        />
        <ChartPriceDetails priceDetails={priceDetails} isPair={isPair} />
      </div>
      <div className="trading-view-body">
        <ChartViewOption
          selectedViewMode={selectedViewMode}
          handleViewModeChange={handleViewModeChange}
        />
        {renderTradingChatView(isLoading, selectedViewMode, tokenPriceData)}
        <ChartRangeSelector
          timeRangeList={timeRangeList}
          selectedTimeRange={selectedTimeRange}
          selectedViewMode={selectedViewMode}
          handleTimeRangeChange={handleRangeChange}
        />
      </div>
    </div>
  );
}
