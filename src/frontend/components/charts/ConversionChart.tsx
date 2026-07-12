// Conversion funnel (views → messages → sales) from the analytics overview hook.
import React, { useMemo } from 'react';
import { Stack, Typography } from '@mui/material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAnalyticsOverview } from '../../services/hooks/index.js';
import type { AnalyticsQueryParams } from '../../state/api/index.js';
import { formatNumber, formatPercent } from '../../utils/formatters.js';
import { ChartState, useChartColors } from './chartShell.js';

export interface ConversionChartProps {
  params?: AnalyticsQueryParams;
  height?: number;
}

export const ConversionChart: React.FC<ConversionChartProps> = ({ params, height = 300 }) => {
  const { data, isLoading, isError, error, refetch } = useAnalyticsOverview(params ?? {});
  const colors = useChartColors();

  const { chartData, conversionRate, isEmpty } = useMemo(() => {
    if (!data) return { chartData: [], conversionRate: 0, isEmpty: true };
    const rows = [
      { stage: 'Views', value: data.totalViews },
      { stage: 'Watchers', value: data.totalWatchers },
      { stage: 'Messages', value: data.totalMessages },
    ];
    const rate = data.totalViews > 0 ? (data.totalMessages / data.totalViews) * 100 : 0;
    const empty =
      data.totalViews === 0 && data.totalWatchers === 0 && data.totalMessages === 0;
    return { chartData: rows, conversionRate: rate, isEmpty: empty };
  }, [data]);

  const stageColors = [colors.primary, colors.secondary, colors.success];

  return (
    <Stack spacing={1} sx={{ height: '100%' }}>
      <Typography variant="body2" color="text.secondary">
        View → message rate:{' '}
        <Typography component="span" variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
          {formatPercent(conversionRate)}
        </Typography>
      </Typography>
      <ChartState
        loading={isLoading}
        error={isError ? error : undefined}
        onRetry={refetch}
        isEmpty={isEmpty}
        height={height}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
            <XAxis dataKey="stage" stroke={colors.axis} fontSize={12} tickLine={false} />
            <YAxis
              stroke={colors.axis}
              fontSize={12}
              tickLine={false}
              width={56}
              tickFormatter={(v: number) => formatNumber(v)}
            />
            <Tooltip
              formatter={(value) => [formatNumber(Number(value ?? 0)), 'Count']}
              cursor={{ fill: colors.grid, opacity: 0.3 }}
              contentStyle={{
                background: colors.tooltipBg,
                border: `1px solid ${colors.tooltipBorder}`,
                borderRadius: 8,
                color: colors.text,
              }}
            />
            <Bar dataKey="value" name="Count" radius={[6, 6, 0, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={stageColors[i % stageColors.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartState>
    </Stack>
  );
};

export default ConversionChart;
