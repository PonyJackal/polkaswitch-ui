import React from "react";
import AssetTableRow from "./AssetTableRow";

export default function AssetsTable({ tokenData }) {
    return (
        <div className="asset-table">
            <div className="columns asset-table__header is-mobile">
                <div className="column is-3 is-half-mobile">
                    <span>Token</span>
                </div>
                <div className="column is-hidden-mobile is-3">
                    <span>Price</span>
                </div>
                <div className="column is-3 is-half-mobile">
                    <span>Balance</span>
                </div>
                <div className="column is-hidden-mobile is-3">
                    <span>Value</span>
                </div>
            </div>

            {tokenData.map((t) => {
                return (
                    <AssetTableRow
                        key={t.symbol}
                        iconUrl={t.iconUrl}
                        name={t.name}
                        symbol={t.symbol}
                        price={t.price}
                        balance={t.balance}
                        value={t.value}
                    ></AssetTableRow>
                );
            })}
        </div>
    );
}
