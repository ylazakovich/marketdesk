import type * as React from 'react';
import type { InputBaseProps } from '@mui/material/InputBase';
import type { InputLabelProps } from '@mui/material/InputLabel';
import type { InputProps as StandardInputProps } from '@mui/material/Input';
import type { FilledInputProps } from '@mui/material/FilledInput';
import type { OutlinedInputProps } from '@mui/material/OutlinedInput';
import type {
  AutocompleteOwnerState,
  AutocompleteRenderValue,
  AutocompleteRenderValueGetItemProps,
} from '@mui/material/Autocomplete';
import type { ResponsiveStyleValue } from '@mui/system';

declare module '@mui/material/Stack' {
  interface StackOwnProps {
    alignItems?: ResponsiveStyleValue<React.CSSProperties['alignItems']> | undefined;
    justifyContent?: ResponsiveStyleValue<React.CSSProperties['justifyContent']> | undefined;
    flexWrap?: ResponsiveStyleValue<React.CSSProperties['flexWrap']> | undefined;
  }
}

declare module '@mui/material/TextField' {
  interface BaseTextFieldProps {
    /** @deprecated Compatibility shim for MUI v8 and earlier call sites. Prefer slotProps.input. */
    InputProps?: Partial<StandardInputProps | FilledInputProps | OutlinedInputProps> | undefined;
    /** @deprecated Compatibility shim for MUI v8 and earlier call sites. Prefer slotProps.htmlInput. */
    inputProps?: InputBaseProps['inputProps'] | undefined;
    /** @deprecated Compatibility shim for MUI v8 and earlier call sites. Prefer slotProps.inputLabel. */
    InputLabelProps?: Partial<InputLabelProps> | undefined;
  }
}

declare module '@mui/material/Autocomplete' {
  interface AutocompleteProps<
    Value,
    Multiple extends boolean | undefined,
    DisableClearable extends boolean | undefined,
    FreeSolo extends boolean | undefined,
    ChipComponent extends React.ElementType = 'div',
  > {
    /** @deprecated Compatibility shim for MUI v8 and earlier call sites. Prefer renderValue. */
    renderTags?: (
      value: AutocompleteRenderValue<Value, Multiple, FreeSolo>,
      getTagProps: AutocompleteRenderValueGetItemProps<Multiple>,
      ownerState: AutocompleteOwnerState<Value, Multiple, DisableClearable, FreeSolo, ChipComponent>,
    ) => React.ReactNode;
  }
}
