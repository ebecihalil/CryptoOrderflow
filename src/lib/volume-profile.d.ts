export type VolumeProfileSettings = {
  market: 'both' | 'spot' | 'perpetual'; sessions: number; rows: number; valueArea: number; width: number;
  placement: 'left' | 'right'; mode: 'updown' | 'total'; showPoc: boolean; showVa: boolean; developing: boolean;
};
export type VolumeProfileRow = { low: number; high: number; up: number; down: number; inValueArea: boolean };
export type SessionProfile = {
  start: number; end: number; low: number; high: number; rowStep: number; rows: VolumeProfileRow[];
  total: number; maxRow: number; poc: number; vah: number; val: number; developing?: boolean;
};
export type VolumeProfilePayload = { asset: string; market: string; sessions: Array<{ time: number; levels: Array<{ price: number; buy: number; sell: number }> }> };
export const VOLUME_PROFILE_DEFAULTS: VolumeProfileSettings;
export function buildSessionProfile(session: VolumeProfilePayload['sessions'][number], settings?: VolumeProfileSettings, priceDivisor?: number): SessionProfile | null;
export function buildProfiles(payload: VolumeProfilePayload | null, settings?: VolumeProfileSettings, priceDivisor?: number, nowSeconds?: number): SessionProfile[];
