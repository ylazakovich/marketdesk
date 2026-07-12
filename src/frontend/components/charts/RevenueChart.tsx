// Revenue + profit area chart over time. Consumes the analytics revenue hook.
import React, { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAnalyticsRevenue } from '../../services/hooks/index.js';
import type { AnalyticsQueryParams, RevenuePoint } from '../../state/api/index.js';
import { useAppSelector } from '../../state/hooks.js';
import { formatCurrency } from '../../utils/formatters.js';
import { ChartState, useChartColors } from './chartShell.js';

export interface RevenueChartProps {
  params?: AnalyticsQueryParams;
  height?: number;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const RevenueChart: React.FC<RevenueChartProps> = ({ params, height = 300 }) => {
  const workspaceCurrency = useAppSelector((s) => s.workspace.currency);
  const { data, isLoading, isError, error, refetch } = useAnalyticsRevenue(params ?? {});
  const colors = useChartColors();

  const currency = data?.currency ?? workspaceCurrency;
  const chartData = useMemo(
    () => (data?.series ?? []).map((p: RevenuePoint) => ({ ...p, label: shortDate(p.date) })),
    [data],
  );

  return (
    <ChartState
      loading={isLoading}
      error={isError ? error : undefined}
      onRetry={refetch}
      isEmpty={chartData.length === 0}
      height={height}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={colors.primary} stopOpacity={0.35} />
              <stop offset="95%" stopColor={colors.primary} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="prevFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={colors.secondary} stopOpacity={0.3} />
              <stop offset="95%" stopColor={colors.secondary} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
          <XAxis dataKey="label" stroke={colors.axis} fontSize={12} tickLine={false} />
          <YAxis
            stroke={colors.axis}
            fontSize={12}
            tickLine={false}
            width={64}
            tickFormatter={(v: number) => formatCurrency(v, currency)}
          />
          <Tooltip
            formatter={(value, name) => [formatCurrency(Number(value ?? 0), currency), String(name)]}
            contentStyle={{
              background: colors.tooltipBg,
              border: `1px solid ${colors.tooltipBorder}`,
              borderRadius: 8,
              color: colors.text,
            }}
          />
          <Legend />
          <Area
            type="monotone"
            dataKey="revenue"
            name="Revenue"
            stroke={colors.primary}
            strokeWidth={2}
            fill="url(#revFill)"
          />
          <Area
            type="monotone"
            dataKey="previous"
            name="Previous period"
            stroke={colors.secondary}
            strokeWidth={2}
            fill="url(#prevFill)"
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartState>
  );
};

export default RevenueChart;
