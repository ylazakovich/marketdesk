// Thin wrapper over MUI Button so the app has a single button entry point.
// Keeps defaults consistent (contained + primary) while forwarding every MUI prop.
import React from 'react';
import { Button as MuiButton } from '@mui/material';
import type { ButtonProps as MuiButtonProps } from '@mui/material';

export type ButtonProps = MuiButtonProps;

export const Button: React.FC<ButtonProps> = ({
  variant = 'contained',
  color = 'primary',
  ...rest
}) => <MuiButton variant={variant} color={color} {...rest} />;

export default Button;
