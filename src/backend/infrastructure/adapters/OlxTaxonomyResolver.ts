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
  parent_id?: string | number | null;
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
    const id = this.canonicalCategoryId(providerCategoryId);
    if (!id) {
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
    const isLeaf = this.leafStatus(node);
    if (isLeaf !== true) throw new Error('OLX category is not a verified leaf category');
    let path = this.path(node, name);
    if (path.length === 0) path = await this.pathFromFlatTaxonomy(id, name);
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

  private async pathFromFlatTaxonomy(id: string, expectedName: string): Promise<string[]> {
    const response = await this.http.request<OlxCategoryNode[] | OlxEnvelope<OlxCategoryNode[]>>({
      method: 'GET',
      url: `${this.baseUrl}/categories`,
    });
    const value = response.data;
    const nodes = Array.isArray(value) ? value : value?.data;
    if (!Array.isArray(nodes)) return [];
    const byId = new Map<string, OlxCategoryNode>();
    for (const node of nodes) {
      const nodeId = this.canonicalCategoryId(node?.id);
      if (!nodeId || byId.has(nodeId)) return [];
      byId.set(nodeId, node);
    }
    const parentsWithChildren = new Set<string>();
    for (const node of nodes) {
      if (node.parent_id === 0) continue;
      const parentId = this.canonicalCategoryId(node.parent_id);
      if (parentId) parentsWithChildren.add(parentId);
    }
    const target = byId.get(id);
    const targetLeaf = target ? this.leafStatus(target) : undefined;
    if (target?.name?.trim() !== expectedName || targetLeaf !== true || parentsWithChildren.has(id)) return [];

    const path: string[] = [];
    const visited = new Set<string>();
    let current: OlxCategoryNode | undefined = target;
    let depth = 0;
    while (current) {
      const currentId = String(current.id ?? '');
      const currentName = current.name?.trim();
      if (!currentId || !currentName || visited.has(currentId) || depth >= 32) return [];
      visited.add(currentId);
      path.unshift(currentName);
      depth += 1;
      if (currentId !== id && this.leafStatus(current) !== false) return [];
      if (current.parent_id === 0) break;
      if (current.parent_id === null || current.parent_id === undefined) return [];
      const parentId = this.canonicalCategoryId(current.parent_id);
      if (!parentId) return [];
      current = byId.get(parentId);
      if (!current) return [];
    }
    return path.length > 1 ? path : [];
  }

  private canonicalCategoryId(value: unknown): string | null {
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    }
    return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : null;
  }

  private leafStatus(node: OlxCategoryNode): boolean | undefined {
    if (typeof node.leaf === 'boolean' && typeof node.is_leaf === 'boolean' && node.leaf !== node.is_leaf) {
      return undefined;
    }
    return node.leaf ?? node.is_leaf
      ?? (Array.isArray(node.children) ? node.children.length === 0 : undefined);
  }
}
