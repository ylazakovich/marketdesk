// Section card with an optional header (title/subtitle + action slot).
// Wraps MUI Card so page sections stay visually consistent with the theme.
import React from 'react';
import { Box, Card as MuiCard, CardContent, Stack, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

export interface CardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  disablePadding?: boolean;
  sx?: SxProps<Theme>;
  contentSx?: SxProps<Theme>;
}

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  action,
  children,
  disablePadding = false,
  sx,
  contentSx,
}) => (
  <MuiCard sx={{ display: 'flex', flexDirection: 'column', height: '100%', ...sx }}>
    {(title || action || subtitle) && (
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        spacing={1}
        sx={{ px: 2.5, pt: 2.25, pb: subtitle ? 0.5 : 1.5 }}
      >
        <Box sx={{ minWidth: 0 }}>
          {title && (
            <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
          )}
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
      </Stack>
    )}
    <CardContent
      sx={{
        flexGrow: 1,
        p: disablePadding ? '0 !important' : 2.5,
        pt: title || subtitle ? 1.5 : undefined,
        '&:last-child': { pb: disablePadding ? 0 : 2.5 },
        ...contentSx,
      }}
    >
      {children}
    </CardContent>
  </MuiCard>
);

export default Card;
