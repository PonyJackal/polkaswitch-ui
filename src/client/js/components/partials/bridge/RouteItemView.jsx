import React from 'react';
import TokenNetworkRouteBox from './TokenNetworkRouteBox';
import SwapBridgeTextBox from './SwapBridgeTextBox';
import AdditionalInfoItem from './AdditionalInfoItem';
import DashedDivider from './DashedDivider';

export default function RouteItemView(props) {
  const data = props.data;

  return (
    <div className="bridge-route-item">
      {data.length > 0 &&
        _.map(data, function (item, index) {
          switch (item.type) {
            case 'token-network':
              return (
                <div
                  key={index}
                  className="is-flex is-flex-direction-row is-align-items-center"
                >
                  <TokenNetworkRouteBox info={item} />
                  {data.length - 2 !== index && <DashedDivider />}
                </div>
              );
            case 'swap':
              return (
                <div
                  key={index}
                  className="is-flex is-flex-direction-row is-align-items-center"
                >
                  <SwapBridgeTextBox info={item} />
                  {data.length - 2 !== index && <DashedDivider />}
                </div>
              );
            case 'bridge':
              return (
                <div
                  key={index}
                  className="is-flex is-flex-direction-row is-align-items-center"
                >
                  <SwapBridgeTextBox info={item} />
                  {data.length - 2 !== index && <DashedDivider />}
                </div>
              );
            case 'additional':
              return <AdditionalInfoItem key={index} info={item} />;
            default:
              return null;
          }
        })}
    </div>
  );
}
