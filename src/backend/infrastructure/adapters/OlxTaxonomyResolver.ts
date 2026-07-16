import type { MarketplaceCategoryMetadata } from '../../../shared/types';
import type { MarketplaceHttpClient } from './MarketplaceHttpClient';

interface OlxCategoryNode {
  id?: string | number;
  name?: string;
  path?: string[] | string;
  leaf?: boolean;
  is_leaf?: boolean;
  children?: unknown[];
  parent?: OlxCategoryNode | null;
}

interface OlxEnvelope<T> { data: T }

export interface OlxTrustedTaxonomyResolver {
  verify(providerCategoryId: string): Promise<MarketplaceCategoryMetadata>;
}

/** Resolves category claims against the authenticated OLX Partner taxonomy API. */
export class OlxTaxonomyResolver implements OlxTrustedTaxonomyResolver {
  private readonly baseUrl: string;

  constructor(
    private readonly http: MarketplaceHttpClient,
    baseUrl = 'https://www.olx.pl/api/partner',
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 24 * 60 * 60 * 1000,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async verify(providerCategoryId: string): Promise<MarketplaceCategoryMetadata> {
    const id = providerCategoryId.trim();
    if (!/^\d+$/.test(id) || Number(id) <= 0) {
      throw new Error('OLX category id must be a positive numeric provider id');
    }
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0 || this.ttlMs > 24 * 60 * 60 * 1000) {
      throw new Error('OLX taxonomy verification TTL is outside server policy');
    }
    const response = await this.http.request<OlxCategoryNode | OlxEnvelope<OlxCategoryNode>>({
      method: 'GET',
      url: `${this.baseUrl}/categories/${id}`,
    });
    const node = this.unwrap(response.data);
    if (String(node.id ?? '') !== id) throw new Error('OLX taxonomy returned a different category id');
    const name = node.name?.trim();
    if (!name) throw new Error('OLX taxonomy category name is missing');
    const isLeaf = node.leaf ?? node.is_leaf ?? (Array.isArray(node.children) ? node.children.length === 0 : undefined);
    if (isLeaf !== true) throw new Error('OLX category is not a verified leaf category');
    const path = this.path(node, name);
    if (path.length === 0 || path[path.length - 1] !== name) {
      throw new Error('OLX taxonomy did not return a complete category path');
    }
    const verifiedAt = this.now();
    if (!Number.isFinite(verifiedAt.getTime())) throw new Error('Server taxonomy verification clock is invalid');
    return {
      providerCategoryId: id,
      name,
      path,
      source: 'provider_taxonomy',
      confidence: 1,
      isLeaf: true,
      taxonomyVerifiedAt: verifiedAt.toISOString(),
      taxonomyStaleAt: new Date(verifiedAt.getTime() + this.ttlMs).toISOString(),
    };
  }

  private unwrap(value: OlxCategoryNode | OlxEnvelope<OlxCategoryNode>): OlxCategoryNode {
    if (!value || typeof value !== 'object') throw new Error('OLX taxonomy response is invalid');
    return 'data' in value ? value.data : value;
  }

  private path(node: OlxCategoryNode, name: string): string[] {
    if (Array.isArray(node.path)) {
      if (node.path.some((part) => typeof part !== 'string' || part.trim().length === 0)) return [];
      return node.path.map((part) => part.trim());
    }
    if (typeof node.path === 'string') {
      const parts = node.path.split(/\s*(?:>|→|\/)\s*/).map((part) => part.trim());
      return parts.some((part) => part.length === 0) ? [] : parts;
    }
    const parents: string[] = [];
    let current = node.parent;
    const visited = new Set<OlxCategoryNode>();
    let depth = 0;
    while (current) {
      if (visited.has(current) || depth >= 32) return [];
      visited.add(current);
      depth += 1;
      if (!current.name?.trim()) return [];
      parents.unshift(current.name.trim());
      current = current.parent;
    }
    return parents.length > 0 ? [...parents, name] : [];
  }
}
