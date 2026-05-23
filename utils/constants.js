// Single source of truth for network names, roles, and statuses
// Frontend must use these exact strings when calling the API

export const NETWORKS = ['Vodacom', 'Airtel', 'Halotel', 'Yas'];

// Display short names for UI (map from API value → display label)
export const NETWORK_SHORT = {
  Vodacom: 'Voda',
  Airtel:  'Airtel',
  Halotel: 'Halotel',
  Yas:     'Yas',
};

export const NETWORK_WALLETS = {
  Vodacom: 'M-Pesa',
  Airtel:  'Airtel Money',
  Halotel: 'Halopesa',
  Yas:     'Mixx',
};

export const ROLES            = ['sub-agent', 'main-agent', 'admin'];
export const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'completed', 'cancelled'];
export const AGENT_STATUSES   = ['pending', 'approved', 'rejected', 'active'];