// Views by listing (top performers) bar chart. Consumes the analytics listings hook.
import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAnalyticsListings } from '../../services/hooks/index.js';
import type { AnalyticsQueryParams } from '../../state/api/index.js';
import { formatNumber } from '../../utils/formatters.js';
import { ChartState, useChartColors } from './chartShell.js';

export interface ViewsChartProps {
  params?: AnalyticsQueryParams;
  height?: number;
  topN?: number;
}

export const ViewsChart: React.FC<ViewsChartProps> = ({
  params,
  height = 300,
  topN = 8,
}) => {
  const { data, isLoading, isError, error, refetch } = useAnalyticsListings(params ?? {});
  const colors = useChartColors();

  // The listings-performance rows are keyed by listing/product, not marketplace,
  // so top performers are labelled by product id.
  const chartData = useMemo(() => {
    const rows = [...(data ?? [])].sort((a, b) => b.views - a.views).slice(0, topN);
    return rows.map((m) => ({
      label: m.productId,
      views: m.views,
    }));
  }, [data, topN]);

  return (
    <ChartState
      loading={isLoading}
      error={isError ? error : undefined}
      onRetry={refetch}
      isEmpty={chartData.length === 0}
      height={height}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
          <XAxis dataKey="label" stroke={colors.axis} fontSize={12} tickLine={false} />
          <YAxis
            stroke={colors.axis}
            fontSize={12}
            tickLine={false}
            width={56}
            tickFormatter={(v: number) => formatNumber(v)}
          />
          <Tooltip
            formatter={(value: number) => [formatNumber(value), 'Views']}
            cursor={{ fill: colors.grid, opacity: 0.3 }}
            contentStyle={{
              background: colors.tooltipBg,
              border: `1px solid ${colors.tooltipBorder}`,
              borderRadius: 8,
              color: colors.text,
            }}
          />
          <Bar dataKey="views" name="Views" fill={colors.primary} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartState>
  );
};

export default ViewsChart;
