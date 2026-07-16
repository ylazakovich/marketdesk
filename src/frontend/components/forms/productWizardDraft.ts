import type { MarketplaceKey, ProductCondition, ProductStatus } from '@shared/types';
import { MARKETPLACE_KEY_LIST, PRODUCT_STATUS_LIST } from '@shared/constants';
import { emptyProductValues } from './productFormModel.js';
import type { ProductFormValues } from './productFormModel.js';

export const PRODUCT_WIZARD_DRAFT_VERSION = 1;
export const PRODUCT_WIZARD_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const PRODUCT_CONDITIONS: readonly ProductCondition[] = [
  'new',
  'like_new',
  'good',
  'fair',
  'poor',
  'refurbished',
  'unknown',
];

export interface ProductWizardDraftState {
  values: ProductFormValues;
  activeStep: number;
  targetMarketplace: MarketplaceKey | null;
}

interface StoredProductWizardDraft extends ProductWizardDraftState {
  version: typeof PRODUCT_WIZARD_DRAFT_VERSION;
  updatedAt: number;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface VolatileProductWizardDraft {
  draft: ProductWizardDraftState;
  updatedAt: number;
}

const volatileDrafts = new Map<string, VolatileProductWizardDraft>();
const discardedDraftKeys = new Set<string>();

function cloneDraft(draft: ProductWizardDraftState): ProductWizardDraftState {
  return {
    values: { ...draft.values, tags: [...draft.values.tags], images: [...draft.values.images] },
    activeStep: draft.activeStep,
    targetMarketplace: draft.targetMarketplace,
  };
}

function timestampIsValid(updatedAt: number, now: number): boolean {
  return (
    Number.isFinite(updatedAt) &&
    updatedAt <= now + 60_000 &&
    now - updatedAt <= PRODUCT_WIZARD_DRAFT_MAX_AGE_MS
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseValues(value: unknown): ProductFormValues | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.name !== 'string' ||
    typeof value.sku !== 'string' ||
    typeof value.description !== 'string' ||
    (value.costPrice !== null &&
      (typeof value.costPrice !== 'number' || !Number.isFinite(value.costPrice))) ||
    typeof value.sellingPrice !== 'number' ||
    !Number.isFinite(value.sellingPrice) ||
    !PRODUCT_CONDITIONS.includes(value.condition as ProductCondition) ||
    typeof value.category !== 'string' ||
    !PRODUCT_STATUS_LIST.includes(value.status as ProductStatus) ||
    !isStringArray(value.tags) ||
    !isStringArray(value.images)
  ) {
    return null;
  }
  return {
    name: value.name,
    sku: value.sku,
    description: value.description,
    costPrice: value.costPrice as number | null,
    sellingPrice: value.sellingPrice,
    condition: value.condition as ProductCondition,
    category: value.category,
    status: value.status as ProductStatus,
    tags: [...value.tags],
    images: [...value.images],
  };
}

export function productWizardDraftStorageKey(workspaceId: string, userId: string): string {
  return `marketdesk.productWizardDraft.v${PRODUCT_WIZARD_DRAFT_VERSION}.${encodeURIComponent(workspaceId)}.${encodeURIComponent(userId)}`;
}

export function hasMeaningfulProductWizardDraft(draft: ProductWizardDraftState): boolean {
  return (
    draft.activeStep > 0 ||
    draft.targetMarketplace !== null ||
    JSON.stringify(draft.values) !== JSON.stringify(emptyProductValues())
  );
}

export function readProductWizardDraft(
  storage: DraftStorage | null,
  key: string,
  now = Date.now()
): ProductWizardDraftState | null {
  if (discardedDraftKeys.has(key)) return null;
  const volatile = volatileDrafts.get(key);
  if (volatile) {
    if (timestampIsValid(volatile.updatedAt, now)) return cloneDraft(volatile.draft);
    volatileDrafts.delete(key);
  }
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== PRODUCT_WIZARD_DRAFT_VERSION) return null;
    if (typeof parsed.updatedAt !== 'number' || !timestampIsValid(parsed.updatedAt, now)) {
      return null;
    }
    if (
      typeof parsed.activeStep !== 'number' ||
      !Number.isInteger(parsed.activeStep) ||
      parsed.activeStep < 0 ||
      parsed.activeStep > 5
    ) {
      return null;
    }
    const targetMarketplace = parsed.targetMarketplace;
    if (
      targetMarketplace !== null &&
      !MARKETPLACE_KEY_LIST.includes(targetMarketplace as MarketplaceKey)
    ) {
      return null;
    }
    const values = parseValues(parsed.values);
    if (!values) return null;
    return {
      values,
      activeStep: parsed.activeStep,
      targetMarketplace: targetMarketplace as MarketplaceKey | null,
    };
  } catch {
    return null;
  }
}

export function writeProductWizardDraft(
  storage: DraftStorage | null,
  key: string,
  draft: ProductWizardDraftState,
  now = Date.now()
): boolean {
  if (!storage) {
    discardedDraftKeys.delete(key);
    volatileDrafts.set(key, { draft: cloneDraft(draft), updatedAt: now });
    return false;
  }
  try {
    const stored: StoredProductWizardDraft = {
      ...draft,
      version: PRODUCT_WIZARD_DRAFT_VERSION,
      updatedAt: now,
    };
    storage.setItem(key, JSON.stringify(stored));
    volatileDrafts.delete(key);
    discardedDraftKeys.delete(key);
    return true;
  } catch {
    discardedDraftKeys.delete(key);
    volatileDrafts.set(key, { draft: cloneDraft(draft), updatedAt: now });
    return false;
  }
}

export function removeProductWizardDraft(storage: DraftStorage | null, key: string): boolean {
  volatileDrafts.delete(key);
  if (!storage) {
    discardedDraftKeys.add(key);
    return false;
  }
  try {
    storage.removeItem(key);
    discardedDraftKeys.delete(key);
    return true;
  } catch {
    discardedDraftKeys.add(key);
    return false;
  }
}
