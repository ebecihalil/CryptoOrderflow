export function canonicalAsset(base) {
    base = base.trim().toUpperCase();
    const letterMultiplier = base.match(/^1([KM])([A-Z].*)$/i);
    if (letterMultiplier) {
        const multiplier = letterMultiplier[1].toUpperCase() === "M" ? 1_000_000 : 1_000;
        return { asset: letterMultiplier[2], priceDivisor: multiplier };
    }
    const match = base.match(/^(10{2,})([A-Z].*)$/i);
    if (!match) return { asset: base, priceDivisor: 1 };
    const multiplier = Number(match[1]);
    return Number.isSafeInteger(multiplier) ? { asset: match[2], priceDivisor: multiplier } : { asset: base, priceDivisor: 1 };
}
