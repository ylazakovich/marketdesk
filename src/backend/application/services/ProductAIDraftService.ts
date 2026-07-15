import type {
  ProductAIDraft,
  ProductAIDraftRequest,
  ProductCondition,
  ProductStatus,
} from '../../../shared/types';
import { Product } from '../../domain/entities/Product';
import type { IAIProvider } from '../../domain/ports/IAIProvider';
import { ValidationError } from '../../domain/shared/DomainError';
import { Err, Ok, type Result } from '../../domain/shared/Result';
import { Money } from '../../domain/valueObjects/Money';

const DESCRIPTION_FALLBACK =
  'AI draft placeholder. Review details, add exact dimensions, defects, accessories, and final marketplace-specific wording before publishing.';

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function slugSku(title: string): string {
  const slug = title
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return slug ? `AI-${slug}` : 'AI-DRAFT';
}

function uniqueStrings(values: string[] | undefined): string[] {
  return Array.from(
    new Set((values ?? []).map((value) => value.trim()).filter((value) => value.length > 0)),
  );
}

function safeCondition(value: ProductCondition | undefined): ProductCondition {
  return value ?? 'unknown';
}

function safeStatus(value: ProductStatus | undefined): ProductStatus {
  return value ?? 'draft';
}

function confidenceFromScore(score: number): number {
  return Math.max(0.35, Math.min(0.82, score / 100));
}

export class ProductAIDraftService {
  constructor(private readonly aiProvider?: IAIProvider) {}

  async generateDraft(
    input: ProductAIDraftRequest & { workspaceId: string },
  ): Promise<Result<ProductAIDraft>> {
    if (!input.workspaceId) {
      return Err(new ValidationError('Workspace is required for AI draft generation'));
    }

    if (input.mode === 'title') return this.fromTitle(input);
    if (input.mode === 'photos') return this.fromPhotos(input);

    return Err(new ValidationError('Unsupported AI product draft mode'));
  }

  private async fromTitle(
    input: ProductAIDraftRequest & { workspaceId: string },
  ): Promise<Result<ProductAIDraft>> {
    const title = normalizeText(input.title ?? input.existingFields?.name);
    if (!title) return Err(new ValidationError('Title is required to generate a product draft'));

    const existing = input.existingFields ?? {};
    const baseFields = this.baseFields(input.workspaceId, title, existing, {
      category: 'uncategorised',
      tags: title.toLowerCase().split(' ').slice(0, 4),
      images: uniqueStrings(existing.images),
    });
    const ai = await this.enrichWithAI(input.workspaceId, baseFields);
    const fields = {
      ...baseFields,
      name: ai.generatedTitle || baseFields.name,
    };

    return Ok({
      mode: 'title',
      fields,
      confidence: ai.confidence ?? 0.54,
      uncertainFields: ['category', 'condition', 'sellingPrice'],
      missingInfoQuestions: [
        'What is the real condition and are there visible defects?',
        'What selling price and category should be used for the target marketplace?',
        'Are accessories, dimensions, warranty, or pickup/shipping details relevant?',
      ],
      notes: [
        ai.usedProvider
          ? 'Hermes provider generated the draft title and listing-quality notes for review.'
          : 'Hermes provider was unavailable; deterministic fallback fields were prepared for review.',
        ...ai.suggestions,
        'This is a review draft only; publishing still requires the normal confirmation flow.',
      ],
    });
  }

  private async fromPhotos(
    input: ProductAIDraftRequest & { workspaceId: string },
  ): Promise<Result<ProductAIDraft>> {
    const inputImages = uniqueStrings(input.imageUrls);
    const imageUrls = inputImages.length > 0 ? inputImages : uniqueStrings(input.existingFields?.images);
    if (imageUrls.length === 0) {
      return Err(new ValidationError('At least one product photo URL is required'));
    }

    const existing = input.existingFields ?? {};
    const title = normalizeText(input.title ?? existing.name) || 'Product from photos';
    const baseFields = this.baseFields(input.workspaceId, title, existing, {
      category: 'needs-review',
      tags: ['photo-draft', 'needs-review'],
      images: imageUrls,
    });
    const ai = await this.enrichWithAI(input.workspaceId, baseFields);
    const fields = {
      ...baseFields,
      name: normalizeText(input.title ?? existing.name) || ai.generatedTitle || baseFields.name,
      images: imageUrls,
    };

    return Ok({
      mode: 'photos',
      fields,
      confidence: ai.confidence ?? 0.46,
      uncertainFields: ['name', 'category', 'condition', 'sellingPrice'],
      missingInfoQuestions: [
        'What exact brand/model is shown in the photos?',
        'Are there defects, missing parts, dimensions, or accessories not visible in the photos?',
        'What target price should be used before creating marketplace listings?',
      ],
      notes: [
        ai.usedProvider
          ? 'Hermes provider reviewed the photo-backed product context and suggested review notes.'
          : 'Photo-first draft keeps uploaded image URLs and marks inferred fields as uncertain.',
        ...ai.suggestions,
        'The draft is not saved or published until the user applies it and creates the product.',
      ],
    });
  }

  private baseFields(
    workspaceId: string,
    title: string,
    existing: NonNullable<ProductAIDraftRequest['existingFields']>,
    defaults: { category: string; tags: string[]; images: string[] },
  ): NonNullable<ProductAIDraft['fields']> {
    return {
      name: title,
      sku: existing.sku?.trim() || slugSku(title),
      description: normalizeText(existing.description) || `${title}. ${DESCRIPTION_FALLBACK}`,
      costPrice: existing.costPrice ?? 0,
      sellingPrice: existing.sellingPrice ?? 0,
      condition: safeCondition(existing.condition),
      category: normalizeText(existing.category) || defaults.category,
      status: safeStatus(existing.status),
      tags: uniqueStrings([...(existing.tags ?? []), ...defaults.tags]),
      images: defaults.images,
    };
  }

  private async enrichWithAI(
    workspaceId: string,
    fields: NonNullable<ProductAIDraft['fields']>,
  ): Promise<{ generatedTitle: string | null; suggestions: string[]; confidence: number | null; usedProvider: boolean }> {
    if (!this.aiProvider) {
      return { generatedTitle: null, suggestions: [], confidence: null, usedProvider: false };
    }

    try {
      const product = this.toSyntheticProduct(workspaceId, fields);
      const [generatedTitle, analysis] = await Promise.all([
        this.aiProvider.generateTitle(product, null),
        this.aiProvider.analyzeListing(product),
      ]);
      return {
        generatedTitle: normalizeText(generatedTitle) || null,
        suggestions: analysis.suggestions.map(normalizeText).filter(Boolean).slice(0, 4),
        confidence: confidenceFromScore(analysis.score),
        usedProvider: true,
      };
    } catch {
      return { generatedTitle: null, suggestions: [], confidence: null, usedProvider: false };
    }
  }

  private money(amount: number) {
    const result = Money.of(amount, 'PLN');
    if (result.isErr()) throw result.error;
    return result.value;
  }

  private toSyntheticProduct(workspaceId: string, fields: NonNullable<ProductAIDraft['fields']>): Product {
    return Product.reconstitute({
      id: `ai-draft-${workspaceId}`,
      workspaceId,
      sku: fields.sku || 'AI-DRAFT',
      name: fields.name || 'Product draft',
      description: fields.description || DESCRIPTION_FALLBACK,
      costPrice: this.money(fields.costPrice ?? 0),
      sellingPrice: this.money(fields.sellingPrice ?? 0),
      condition: safeCondition(fields.condition),
      category: fields.category || 'needs-review',
      status: safeStatus(fields.status),
      tags: fields.tags ?? [],
      images: fields.images ?? [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
