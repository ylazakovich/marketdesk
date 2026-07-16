// Semantic status/severity chips. A generic <Badge> plus typed wrappers that
// map the domain unions (ARCHITECTURE §3) to consistent colors + labels.
import React from 'react';
import { Chip } from '@mui/material';
import type { ChipProps } from '@mui/material';
import type {
  ProductStatus,
  ListingStatus,
  HermesSeverity,
  HermesEventStatus,
  AutonomyDecision,
  MarketplaceAccountStatus,
} from '@shared/types';

type ChipColor = ChipProps['color'];

export interface BadgeProps {
  label: string;
  color?: ChipColor;
  variant?: ChipProps['variant'];
  size?: ChipProps['size'];
  icon?: ChipProps['icon'];
}

export const Badge: React.FC<BadgeProps> = ({
  label,
  color = 'default',
  variant = 'filled',
  size = 'small',
  icon,
}) => (
  <Chip
    label={label}
    color={color}
    variant={variant}
    size={size}
    icon={icon}
    sx={{ fontWeight: 600 }}
  />
);

const PRODUCT_STATUS_META: Record<ProductStatus, { label: string; color: ChipColor }> = {
  draft: { label: 'Draft', color: 'default' },
  active: { label: 'Active', color: 'success' },
  attention: { label: 'Needs attention', color: 'warning' },
  sold: { label: 'Sold', color: 'info' },
};

const LISTING_STATUS_META: Record<ListingStatus, { label: string; color: ChipColor }> = {
  live: { label: 'Live', color: 'success' },
  draft: { label: 'Draft', color: 'default' },
  expired: { label: 'Expired', color: 'warning' },
  error: { label: 'Error', color: 'error' },
};

const SEVERITY_META: Record<HermesSeverity, { label: string; color: ChipColor }> = {
  info: { label: 'Info', color: 'info' },
  success: { label: 'Success', color: 'success' },
  warning: { label: 'Warning', color: 'warning' },
  critical: { label: 'Critical', color: 'error' },
};

const HERMES_STATUS_META: Record<HermesEventStatus, { label: string; color: ChipColor }> = {
  pending_decision: { label: 'Decision pending', color: 'info' },
  pending_review: { label: 'Pending review', color: 'warning' },
  applying: { label: 'Applying', color: 'info' },
  applied: { label: 'Applied', color: 'success' },
  dismissed: { label: 'Dismissed', color: 'default' },
  failed: { label: 'Action failed', color: 'error' },
  reverting: { label: 'Reverting', color: 'info' },
  reverted: { label: 'Reverted', color: 'default' },
};

const DECISION_META: Record<AutonomyDecision, { label: string; color: ChipColor }> = {
  auto_apply: { label: 'Auto-applied', color: 'secondary' },
  pending_review: { label: 'Awaiting approval', color: 'warning' },
};

const CONNECTION_META: Record<MarketplaceAccountStatus, { label: string; color: ChipColor }> = {
  connected: { label: 'Connected', color: 'success' },
  disconnected: { label: 'Disconnected', color: 'default' },
  error: { label: 'Error', color: 'error' },
};

export const ProductStatusBadge: React.FC<{ status: ProductStatus }> = ({ status }) => {
  const meta = PRODUCT_STATUS_META[status];
  return <Badge label={meta.label} color={meta.color} variant="outlined" />;
};

export const ListingStatusBadge: React.FC<{ status: ListingStatus }> = ({ status }) => {
  const meta = LISTING_STATUS_META[status];
  return <Badge label={meta.label} color={meta.color} variant="outlined" />;
};

export const HermesSeverityBadge: React.FC<{ severity: HermesSeverity }> = ({ severity }) => {
  const meta = SEVERITY_META[severity];
  return <Badge label={meta.label} color={meta.color} />;
};

export const HermesStatusBadge: React.FC<{ status: HermesEventStatus }> = ({ status }) => {
  const meta = HERMES_STATUS_META[status];
  return <Badge label={meta.label} color={meta.color} variant="outlined" />;
};

export const AutonomyDecisionBadge: React.FC<{ decision: AutonomyDecision }> = ({ decision }) => {
  const meta = DECISION_META[decision];
  return <Badge label={meta.label} color={meta.color} variant="outlined" />;
};

export const ConnectionBadge: React.FC<{ status: MarketplaceAccountStatus }> = ({ status }) => {
  const meta = CONNECTION_META[status];
  return <Badge label={meta.label} color={meta.color} variant="outlined" />;
};

export default Badge;
