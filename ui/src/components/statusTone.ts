// Status -> badge tone mappings, kept separate from the StatusBadge component
// so the component file only exports a component (react-refresh friendly).

export type StatusTone = 'success' | 'warning' | 'error' | 'muted' | 'primary';

export function listingTone(status: string): StatusTone {
  switch (status) {
    case 'active':
      return 'success';
    case 'claimed':
      return 'primary';
    case 'expired':
      return 'muted';
    default:
      return 'muted';
  }
}

export function claimTone(status: string): StatusTone {
  switch (status) {
    case 'confirmed':
    case 'fulfilled':
      return 'success';
    case 'pending':
      return 'warning';
    case 'cancelled':
      return 'error';
    default:
      return 'muted';
  }
}

export function plantingTone(status: string): StatusTone {
  switch (status) {
    case 'growing':
      return 'success';
    case 'planned':
      return 'primary';
    case 'harvested':
      return 'muted';
    case 'failed':
      return 'error';
    default:
      return 'muted';
  }
}
