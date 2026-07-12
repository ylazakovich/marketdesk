# MUI Material Conventions

## Wrapping and setup

Every component must be wrapped in `ThemeProvider` + `CssBaseline`:

```jsx
import { ThemeProvider, CssBaseline, createTheme, Button } from '@mui/material';
const theme = createTheme(); // or customize with createTheme({ palette: { primary: { main: '#1976d2' } } })

<ThemeProvider theme={theme}>
  <CssBaseline />
  <Button variant="contained">Click me</Button>
</ThemeProvider>
```

`ThemeProvider` injects the design tokens (colors, typography, spacing) via React context. Without it, components render with no styles. `CssBaseline` normalizes browser defaults and sets the body background.

The bundle exports `window.MuiMaterial.defaultTheme` (a pre-built default theme) for quick use.

## Styling idiom

MUI is a **prop-based CSS-in-JS system** (Emotion). Do not apply CSS classes from a stylesheet — all styling goes through component props:

- **`variant`** — the primary visual axis: `"contained"`, `"outlined"`, `"text"` (Button); `"filled"`, `"outlined"`, `"standard"` (TextField); etc.
- **`color`** — semantic palette: `"primary"`, `"secondary"`, `"error"`, `"warning"`, `"info"`, `"success"`
- **`size`** — `"small"`, `"medium"`, `"large"`
- **`sx`** prop — escape hatch for one-off styles using theme tokens: `sx={{ mt: 2, color: 'primary.main', bgcolor: 'background.paper' }}`

The `sx` prop maps to theme tokens. Spacing integers multiply 8px (`mt: 2` → 16px). Colors reference the theme palette (`'primary.main'`, `'text.secondary'`, `'background.default'`).

No utility CSS classes — this is not Tailwind. New class names are never legitimate.

## Where the truth lives

- Per-component API: each `<Name>.d.ts` file — read `<Name>Props` for the full prop list
- Usage docs: each `<Name>.prompt.md` — copied from the MUI documentation
- Styles: no static stylesheet; Emotion injects `<style>` tags at runtime via the bundle

## Idiomatic build snippet

```jsx
// ThemeProvider + CssBaseline wrap all content
import { ThemeProvider, CssBaseline, createTheme, Button, Stack, TextField } from '@mui/material';

const theme = createTheme();

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Stack spacing={2} direction="row" sx={{ p: 2 }}>
        <TextField label="Email" variant="outlined" size="small" />
        <Button variant="contained" color="primary" size="medium">
          Submit
        </Button>
      </Stack>
    </ThemeProvider>
  );
}
```

# MuiMaterial (@mui/material@9.1.1)

This design system is the published @mui/material React library, bundled as a single
browser global. All 129 components are the real upstream code.

## Where things are

- `_ds_bundle.js` — the whole-DS bundle at the project root; loads every component to `window.MuiMaterial`. First line is a `/* @ds-bundle: … */` metadata header.
- `styles.css` — the single stylesheet entry (tokens and fonts; this DS injects component styles at runtime). Link this one file.
- `components/<group>/<Name>/<Name>.prompt.md` (example JSX + variants), `<Name>.d.ts` (types), `<Name>.html` (variant grid).
- `tokens/*.css` — CSS custom properties, names verbatim from upstream.
- `fonts/` — `@font-face` files + `fonts.css` (when the package ships fonts).

For a specific component, `read_file("components/<group>/<Name>/<Name>.prompt.md")`.

## Loading

Add these two lines to your page once (React must be on the page first):

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
```

Components are then available at `window.MuiMaterial.*`. Mount into a dedicated child node (e.g. `<div id="ds-root">`), not the host page's own React root, so the two trees don't collide:

```jsx
const { Accordion } = window.MuiMaterial;
ReactDOM.createRoot(document.getElementById('ds-root')).render(<Accordion />);
```

Wrap the tree in the provider — most components read theme/i18n from context:

```jsx
<ThemeProvider theme={defaultTheme}><CssBaseline>{children}</CssBaseline></ThemeProvider>
```

## Tokens

0 CSS custom properties from @mui/material. Names are
preserved verbatim from upstream. None detected — this DS may compute styles at runtime (CSS-in-JS).



## Components

### general
- `Accordion` — Demos:
- `AccordionActions` — Demos:
- `AccordionDetails` — Demos:
- `AccordionSummary` — Demos:
- `Alert` — Demos:
- `AlertTitle` — Demos:
- `AppBar` — Demos:
- `Autocomplete` — Demos:
- `Avatar` — Demos:
- `AvatarGroup` — Demos:
- `Backdrop` — Demos:
- `Badge` — Demos:
- `BottomNavigation` — Demos:
- `BottomNavigationAction` — Demos:
- `Box` — Demos:
- `Breadcrumbs` — Demos:
- `Button` — Demos:
- `ButtonBase` — ButtonBase contains as few styles as possible.
- `ButtonGroup` — Demos:
- `Card` — Demos:
- `CardActionArea` — Demos:
- `CardActions` — Demos:
- `CardContent` — Demos:
- `CardHeader` — Demos:
- `CardMedia` — Demos:
- `Checkbox` — Demos:
- `Chip` — Chips represent complex entities in small blocks, such as a contact.
- `CircularProgress` —  ARIA
- `ClickAwayListener` — Listen for click events that occur somewhere in the document, outside of the element itself.
- `Collapse` — The Collapse transition is used by the
- `Container` — Demos:
- `CssBaseline` — Kickstart an elegant, consistent, and simple baseline to build upon.
- `Dialog` — Dialogs are overlaid modal paper based components with a backdrop.
- `DialogActions` — Demos:
- `DialogContent` — Demos:
- `DialogContentText` — Demos:
- `DialogTitle` — Demos:
- `Divider` — Demos:
- `Drawer` — The props of the Modal(https://mui.com/material-ui/api/modal/) component are available
- `Fab` — Demos:
- `Fade` — The Fade transition is used by the Modal(https://mui.com/material-ui/react-modal/) component.
- `FilledInput` — Demos:
- `FormControl` — Provides context such as filled/focused/error/required for form inputs.
- `FormControlLabel` — Drop-in replacement of the Radio, Switch and Checkbox component.
- `FormGroup` — FormGroup wraps controls such as Checkbox and Switch.
- `FormHelperText` — Demos:
- `FormLabel` — Demos:
- `GlobalStyles` — Demos:
- `Grid` — Demos:
- `Grow` — The Grow transition is used by the Tooltip(https://mui.com/material-ui/react-tooltip/) and
- `Icon` — Demos:
- `IconButton` — Refer to the Icons(https://mui.com/material-ui/icons/) section of the documentation
- `ImageList` — Demos:
- `ImageListItem` — Demos:
- `ImageListItemBar` — Demos:
- `InitColorSchemeScript` — Demos:
- `Input` — Demos:
- `InputAdornment` — Demos:
- `InputBase` — InputBase contains as few styles as possible.
- `InputLabel` — Demos:
- `LinearProgress` —  ARIA
- `Link` — Demos:
- `List` — Demos:
- `ListItem` — Demos:
- `ListItemAvatar` — A simple wrapper to apply List styles to an Avatar.
- `ListItemButton` — Demos:
- `ListItemIcon` — A simple wrapper to apply List styles to an Icon or SvgIcon.
- `ListItemSecondaryAction` — Must be used as the last child of ListItem to function properly.
- `ListItemText` — Demos:
- `ListSubheader` — Demos:
- `Menu` — Demos:
- `MenuItem` — Demos:
- `MenuList` — A permanently displayed menu following https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/.
- `MobileStepper` — Demos:
- `Modal` — Modal is a lower-level construct that is leveraged by the following components:
- `NativeSelect` — An alternative to Select native / with a much smaller bundle size footprint.
- `NoSsr` — NoSsr purposely removes components from the subject of Server Side Rendering (SSR).
- `OutlinedInput` — Demos:
- `Pagination` — Demos:
- `PaginationItem` — Demos:
- `Paper` — Demos:
- `Popover` — Demos:
- `Popper` — Demos:
- `Portal` — Portals provide a first-class way to render children into a DOM node
- `Radio` — Demos:
- `RadioGroup` — Demos:
- `Rating` — Demos:
- `ScopedCssBaseline` — Demos:
- `Select` — Demos:
- `Skeleton` — Demos:
- `Slide` — The Slide transition is used by the Drawer(https://mui.com/material-ui/react-drawer/) component.
- `Slider` — Demos:
- `Snackbar` — Demos:
- `SnackbarContent` — Demos:
- `SpeedDial` — Demos:
- `SpeedDialAction` — Demos:
- `SpeedDialIcon` — Demos:
- `Stack` — Demos:
- `Step` — Demos:
- `StepButton` — Demos:
- `StepConnector` — Demos:
- `StepContent` — Demos:
- `StepIcon` — Demos:
- `StepLabel` — Demos:
- `Stepper` — Demos:
- `SvgIcon` — Demos:
- `SwipeableDrawer` — Demos:
- `Switch` — Demos:
- `Tab` — Demos:
- `Table` — Demos:
- `TableBody` — Demos:
- `TableCell` — The component renders a th element when the parent context is a header
- `TableContainer` — Demos:
- `TableFooter` — Demos:
- `TableHead` — Demos:
- `TablePagination` — A TableCell based component for placing inside TableFooter for pagination.
- `TablePaginationActions` — Demos:
- `TableRow` — Will automatically set dynamic row height
- `TableSortLabel` — A button based label for placing inside TableCell for column sorting.
- `Tabs` — Demos:
- `TabScrollButton` — Demos:
- `TextareaAutosize` — Demos:
- `TextField` — The TextField is a convenience wrapper for the most common cases (80).
- `ToggleButton` — Demos:
- `ToggleButtonGroup` — Demos:
- `Toolbar` — Demos:
- `Tooltip` — Demos:
- `Typography` — Demos:
- `Zoom` — The Zoom transition can be used for the floating variant of the
