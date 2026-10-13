/**
 * OI-weight the account shares, not the unbounded raw L/S ratios.
 * This is a synthetic OI-weighted account-positioning index, not pooled counts.
 */
export function weightedAccountRatio(items) {
    const usable = items.filter(item => Number.isFinite(item.ratio) && item.ratio > 0 &&
        Number.isFinite(item.weight) && item.weight > 0);
    if (!usable.length) return null;
    // Preserve exact provider values for a lone source or identical sources.
    if (usable.every(item => item.ratio === usable[0].ratio)) return usable[0].ratio;
    const largestWeight = Math.max(...usable.map(item => item.weight));
    let weightedLong = 0, weightedShort = 0;
    for (const { ratio, weight } of usable) {
        const normalizedWeight = weight / largestWeight;
        weightedLong += normalizedWeight * (ratio / (1 + ratio));
        weightedShort += normalizedWeight / (1 + ratio);
    }
    // Accumulate short shares directly; 1 - longShare loses precision near 100%.
    const ratio = weightedShort > 0 ? weightedLong / weightedShort : null;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}
