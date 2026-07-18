import React, { useEffect, useMemo, useRef, useState } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import {
  Alert,
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded';
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { useNavigate } from 'react-router-dom';
import type { HermesEvent, Listing, Product } from '@shared/types';
import {
  useGetHermesEventsQuery,
  useGetListingsQuery,
  useGetProductsQuery,
} from '../../state/api/index.js';

const SEARCH_DEBOUNCE_MS = 200;
const RECENT_LIMIT = 5;

type SearchScope = 'all' | 'products' | 'listings' | 'events';
type ResultGroup = 'Quick actions' | 'Products' | 'Listings' | 'Hermes events';

export interface CommandPaletteResult {
  key: string;
  group: ResultGroup;
  title: string;
  subtitle: string;
  path: string;
  icon: React.ReactNode;
}

function containsQuery(values: Array<string | undefined>, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return values.some((value) => value?.toLocaleLowerCase().includes(needle));
}

export function filterListingsForCommandPalette(listings: Listing[], query: string): Listing[] {
  return listings.filter((listing) =>
    containsQuery(
      [
        listing.productName,
        listing.productSku,
        listing.id,
        listing.marketplaceListingId,
        listing.marketplaceId,
        listing.status,
      ],
      query
    )
  );
}

export function filterProductsForCommandPalette(products: Product[], query: string): Product[] {
  return products.filter((product) =>
    containsQuery(
      [product.name, product.sku, product.description, product.category, ...product.tags],
      query
    )
  );
}

export function filterHermesEventsForCommandPalette(
  events: HermesEvent[],
  query: string
): HermesEvent[] {
  return events.filter((event) =>
    containsQuery([event.title, event.detail, event.type, event.status, event.severity], query)
  );
}

export function isCommandPaletteShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>
) {
  return event.key.toLocaleLowerCase() === 'k' && (event.metaKey || event.ctrlKey);
}

function ResultIcon({ group }: { group: ResultGroup }) {
  if (group === 'Products') return <Inventory2RoundedIcon fontSize="small" />;
  if (group === 'Listings') return <StorefrontRoundedIcon fontSize="small" />;
  if (group === 'Hermes events') return <AutoAwesomeRoundedIcon fontSize="small" />;
  return <AddRoundedIcon fontSize="small" />;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setDebouncedQuery('');
      setScope('all');
      setActiveIndex(0);
    }
  }, [open]);

  const productQuery = useGetProductsQuery(
    open && (scope === 'all' || scope === 'products')
      ? {
          search: debouncedQuery || undefined,
          sort: '-updatedAt',
          limit: RECENT_LIMIT,
          offset: 0,
        }
      : skipToken
  );
  const listingQuery = useGetListingsQuery(
    open && (scope === 'all' || scope === 'listings')
      ? { sort: '-updatedAt', limit: 25, offset: 0 }
      : skipToken
  );
  const eventQuery = useGetHermesEventsQuery(
    open && (scope === 'all' || scope === 'events')
      ? { sort: '-createdAt', limit: 25, offset: 0 }
      : skipToken
  );

  const groupedResults = useMemo(() => {
    const groups: Array<{ label: ResultGroup; items: CommandPaletteResult[] }> = [];

    if (!debouncedQuery && scope === 'all') {
      groups.push({
        label: 'Quick actions',
        items: [
          {
            key: 'new-product',
            group: 'Quick actions',
            title: 'Create product',
            subtitle: 'Open the product wizard',
            path: '/products?newProduct=1',
            icon: <ResultIcon group="Quick actions" />,
          },
          {
            key: 'pending-reviews',
            group: 'Quick actions',
            title: 'Open pending Hermes reviews',
            subtitle: 'Review AI recommendations',
            path: '/hermes?status=pending_review',
            icon: <ResultIcon group="Hermes events" />,
          },
        ],
      });
    }

    if (scope === 'all' || scope === 'products') {
      const products = filterProductsForCommandPalette(
        productQuery.currentData?.items ?? [],
        debouncedQuery
      );
      groups.push({
        label: 'Products',
        items: products.slice(0, RECENT_LIMIT).map((product: Product) => ({
          key: `product:${product.id}`,
          group: 'Products',
          title: product.name,
          subtitle: `${product.sku} · ${product.status}`,
          path: `/products/${product.id}`,
          icon: <ResultIcon group="Products" />,
        })),
      });
    }

    if (scope === 'all' || scope === 'listings') {
      const listings = filterListingsForCommandPalette(
        listingQuery.currentData ?? [],
        debouncedQuery
      );
      groups.push({
        label: 'Listings',
        items: listings.slice(0, RECENT_LIMIT).map((listing) => ({
          key: `listing:${listing.id}`,
          group: 'Listings',
          title: listing.productName || listing.marketplaceListingId || 'Marketplace listing',
          subtitle: `${listing.productSku || listing.id} · ${listing.status}`,
          path: `/products/${listing.productId}`,
          icon: <ResultIcon group="Listings" />,
        })),
      });
    }

    if (scope === 'all' || scope === 'events') {
      const events = filterHermesEventsForCommandPalette(
        eventQuery.currentData?.items ?? [],
        debouncedQuery
      );
      groups.push({
        label: 'Hermes events',
        items: events.slice(0, RECENT_LIMIT).map((event) => ({
          key: `event:${event.id}`,
          group: 'Hermes events',
          title: event.title,
          subtitle: `${event.type} · ${event.status}`,
          path: event.productId ? `/products/${event.productId}` : '/hermes',
          icon: <ResultIcon group="Hermes events" />,
        })),
      });
    }

    return groups;
  }, [
    debouncedQuery,
    eventQuery.currentData,
    listingQuery.currentData,
    productQuery.currentData,
    scope,
  ]);

  const results = useMemo(() => groupedResults.flatMap((group) => group.items), [groupedResults]);

  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery, scope]);

  const openResult = (result: CommandPaletteResult | undefined) => {
    if (!result) return;
    onClose();
    navigate(result.path);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (results.length ? (index + 1) % results.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) =>
        results.length ? (index - 1 + results.length) % results.length : 0
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      openResult(results[activeIndex]);
    }
  };

  const loading = productQuery.isFetching || listingQuery.isFetching || eventQuery.isFetching;
  const hasError = productQuery.isError || listingQuery.isError || eventQuery.isError;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{
        transition: { onEntered: () => inputRef.current?.focus() },
        paper: { sx: { alignSelf: 'flex-start', mt: { xs: 2, sm: 10 }, borderRadius: 3 } },
      }}
      aria-labelledby="command-palette-title"
    >
      <DialogTitle id="command-palette-title" sx={{ pb: 1 }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}
        >
          <Typography variant="h6" component="span" sx={{ fontWeight: 800 }}>
            Global search
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Esc to close
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent onKeyDown={handleKeyDown} sx={{ px: { xs: 2, sm: 3 }, pb: 3 }}>
        <TextField
          fullWidth
          inputRef={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search products, listings, Hermes events…"
          slotProps={{
            htmlInput: { 'aria-label': 'Search products, listings, and Hermes events' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon />
                </InputAdornment>
              ),
              endAdornment: loading ? <CircularProgress size={18} /> : undefined,
            },
          }}
        />

        <Tabs
          value={scope}
          onChange={(_event, next: SearchScope) => setScope(next)}
          variant="scrollable"
          scrollButtons={false}
          aria-label="Search scope"
          sx={{ minHeight: 42, mt: 1 }}
        >
          <Tab value="all" label="All" sx={{ minHeight: 42 }} />
          <Tab value="products" label="Products" sx={{ minHeight: 42 }} />
          <Tab value="listings" label="Listings" sx={{ minHeight: 42 }} />
          <Tab value="events" label="Hermes events" sx={{ minHeight: 42 }} />
        </Tabs>
        <Divider />

        {hasError && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Some search results are temporarily unavailable.
          </Alert>
        )}

        <List disablePadding sx={{ mt: 1, maxHeight: 'min(52vh, 480px)', overflowY: 'auto' }}>
          {groupedResults.map((group) => {
            if (!group.items.length) return null;
            return (
              <Box key={group.label} component="li" sx={{ listStyle: 'none' }}>
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{ display: 'block', px: 1.5, pt: 1.5, pb: 0.5, fontWeight: 800 }}
                >
                  {group.label}
                </Typography>
                {group.items.map((result) => {
                  const index = results.findIndex((candidate) => candidate.key === result.key);
                  return (
                    <ListItemButton
                      key={result.key}
                      selected={index === activeIndex}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => openResult(result)}
                      sx={{ borderRadius: 2, mb: 0.5, gap: 1.5 }}
                    >
                      <Box sx={{ color: 'primary.main', display: 'grid', placeItems: 'center' }}>
                        {result.icon}
                      </Box>
                      <ListItemText
                        primary={result.title}
                        secondary={result.subtitle}
                        slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                      />
                    </ListItemButton>
                  );
                })}
              </Box>
            );
          })}
        </List>

        {!loading && !results.length && (
          <Box sx={{ py: 5, textAlign: 'center' }}>
            <Typography sx={{ fontWeight: 700 }}>No matching results</Typography>
            <Typography variant="body2" color="text.secondary">
              Try another phrase or search scope.
            </Typography>
          </Box>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          ↑↓ Navigate · Enter open · Esc close
        </Typography>
      </DialogContent>
    </Dialog>
  );
};

export default CommandPalette;
