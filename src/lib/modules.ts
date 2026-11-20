export type ModuleInfo = {
  title: string;
  mark: string;
  path: string;
  description: string;
  /** Home-page group: clicking the card reveals these options. */
  children?: ModuleInfo[];
};

export const MODULES: ModuleInfo[] = [
  { title: 'Global Long Short Account Ratio', mark: 'LS', path: '/long-short-account-ratio', description: 'OI-weighted positioning of all accounts across perpetual markets.' },
  { title: 'Top Trader Long Short Account Ratio', mark: 'TT', path: '/top-trader-long-short-account-ratio', description: 'OI-weighted positioning of top traders on Binance, OKX and Gate.io.' },
  { title: 'Funding Rate', mark: 'FR', path: '/funding-rate', description: 'Funding dynamics across perpetual venues.' },
  { title: 'Open Interest', mark: 'OI', path: '/open-interest', description: 'Open interest changes across markets.' },
  { title: 'Leverage Estimate', mark: 'LE', path: '/leverage-estimate', description: 'Estimated average leverage across perpetual markets.' },
  { title: 'Liquidations', mark: 'LI', path: '/liquidations', description: 'Liquidation activity across perpetual markets.' },
  { title: 'CVD', mark: 'CV', path: '/cvd', description: 'Cumulative volume delta across markets.' },
  { title: 'Super Charts (Indicators)', mark: 'SC', path: '/super-charts', description: 'Charting tools, orderflow indicators and technical indicators.' },
];

const LSAR_PATHS = ['/long-short-account-ratio', '/top-trader-long-short-account-ratio'];

/** Long Short Account Ratio: one home card that opens to Global / Top Trader. */
export const LSAR_GROUP: ModuleInfo = {
  title: 'Long Short Account Ratio', mark: 'LS', path: '/long-short-account-ratio',
  description: 'OI-weighted account positioning: all accounts or top traders.',
  children: MODULES.filter((module) => LSAR_PATHS.includes(module.path)),
};

export const HOME_MODULES: ModuleInfo[] = MODULES
  .filter((module) => module.path !== '/cvd' && module.path !== '/liquidations')
  .flatMap((module) => module.path === LSAR_PATHS[0] ? [LSAR_GROUP] : LSAR_PATHS.includes(module.path) ? [] : [module]);
