const securityTags = new Set(["tokenized-stock", "tokenized-etfs", "robinhood-stock"]);

export function isStockOrEtfIdentity(identity) {
    return (identity.tags ?? []).some(tag => securityTags.has(tag)) ||
        /\btokeni[sz]ed\s+(?:stock|etf|fund)\b|\bxstock\b|\(\s*derivatives\s*\)/i.test(identity.name ?? "");
}
export function buildFinancialIdentityIndex(identities) {
    return {
        source: "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing",
        ids: [...new Set(identities.filter(isStockOrEtfIdentity)
            .map(identity => identity.id).filter(id => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b),
    };
}
