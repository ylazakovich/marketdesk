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

interface OlxResolvedPath {
  ids: string[];
  names: string[];
  validatedAtMs: number;
}

interface OlxDetailPath {
  ids?: string[];
  names: string[];
}

interface OlxValidatedGraph {
  byId: Map<string, OlxCategoryNode>;
  parentsWithChildren: Set<string>;
  validatedAtMs: number;
}

export interface OlxTrustedTaxonomyResolver {
  verify(providerCategoryId: string): Promise<MarketplaceCategoryMetadata>;
}

/** Resolves category claims against the authenticated OLX Partner taxonomy API. */
export class OlxTaxonomyResolver implements OlxTrustedTaxonomyResolver {
  private readonly baseUrl: string;
  private flatGraphCache?: { expiresAt: number; graph: OlxValidatedGraph };
  private flatGraphInFlight?: Promise<OlxValidatedGraph | null>;

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
    if (this.canonicalCategoryId(node.id) !== id) throw new Error('OLX taxonomy returned a different category id');
    const name = node.name?.trim();
    if (!name) throw new Error('OLX taxonomy category name is missing');
    const isLeaf = this.leafStatus(node);
    if (isLeaf !== true) throw new Error('OLX category is not a verified leaf category');
    const directPath = this.detailPath(node, name, id);
    const resolvedPath = await this.pathFromFlatTaxonomy(id, name);
    if (!resolvedPath) throw new Error('OLX taxonomy did not return a complete category path');
    if (Object.prototype.hasOwnProperty.call(node, 'parent_id')) {
      const detailParentId = this.canonicalCategoryId(node.parent_id);
      const expectedParentId = resolvedPath.ids[resolvedPath.ids.length - 2];
      if (!detailParentId || detailParentId !== expectedParentId) {
        throw new Error('OLX taxonomy detail parent does not match the flat taxonomy');
      }
    }
    if (directPath && (
      !this.samePath(directPath.names, resolvedPath.names)
      || (directPath.ids !== undefined && !this.samePath(directPath.ids, resolvedPath.ids))
    )) {
      throw new Error('OLX taxonomy detail path does not match the flat taxonomy');
    }
    const path = resolvedPath.names;
    if (path.length === 0 || path[path.length - 1] !== name) {
      throw new Error('OLX taxonomy did not return a complete category path');
    }
    const verifiedAt = new Date(resolvedPath.validatedAtMs);
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

  private detailPath(node: OlxCategoryNode, name: string, id: string): OlxDetailPath | null {
    const hasParent = Object.prototype.hasOwnProperty.call(node, 'parent');
    if (Array.isArray(node.path)) {
      if (hasParent) throw new Error('OLX taxonomy detail contains conflicting breadcrumb representations');
      if (node.path.some((part) => typeof part !== 'string' || part.trim().length === 0)) {
        throw new Error('OLX taxonomy detail path is malformed');
      }
      const parts = node.path.map((part) => part.trim());
      if (parts.length < 2) throw new Error('OLX taxonomy detail path is incomplete');
      return { names: parts };
    }
    if (typeof node.path === 'string') {
      if (hasParent) throw new Error('OLX taxonomy detail contains conflicting breadcrumb representations');
      const parts = node.path.split(/\s*(?:>|→|\/)\s*/).map((part) => part.trim());
      if (parts.length < 2 || parts.some((part) => part.length === 0)) {
        throw new Error('OLX taxonomy detail path is incomplete');
      }
      return { names: parts };
    }
    if (node.path !== undefined) throw new Error('OLX taxonomy detail path is malformed');
    if (!hasParent) return null;
    if (node.parent === null) throw new Error('OLX taxonomy detail ancestry is incomplete');
    const parentIds: string[] = [];
    const parentNames: string[] = [];
    let current: OlxCategoryNode | null | undefined = node.parent;
    const visited = new Set<string>();
    let depth = 0;
    while (current) {
      const currentId = this.canonicalCategoryId(current.id);
      if (!currentId || visited.has(currentId) || depth >= 32) {
        throw new Error('OLX taxonomy detail ancestry is malformed');
      }
      visited.add(currentId);
      depth += 1;
      if (!current.name?.trim() || this.leafStatus(current) !== false) {
        throw new Error('OLX taxonomy detail ancestry is malformed');
      }
      parentIds.unshift(currentId);
      parentNames.unshift(current.name.trim());
      if (!Object.prototype.hasOwnProperty.call(current, 'parent')) {
        throw new Error('OLX taxonomy detail ancestry is incomplete');
      }
      if (Object.prototype.hasOwnProperty.call(current, 'parent_id')) {
        if (current.parent === null) {
          if (current.parent_id !== 0) throw new Error('OLX taxonomy detail ancestry is malformed');
        } else {
          const parentId = this.canonicalCategoryId(current.parent_id);
          const nestedParentId = this.canonicalCategoryId(current.parent?.id);
          if (!parentId || !nestedParentId || parentId !== nestedParentId) {
            throw new Error('OLX taxonomy detail ancestry is malformed');
          }
        }
      }
      current = current.parent;
    }
    return { ids: [...parentIds, id], names: [...parentNames, name] };
  }

  private async pathFromFlatTaxonomy(id: string, expectedName: string): Promise<OlxResolvedPath | null> {
    const graph = await this.validatedFlatGraph();
    if (!graph) return null;
    const { byId, parentsWithChildren } = graph;
    const target = byId.get(id);
    const targetLeaf = target ? this.leafStatus(target) : undefined;
    if (target?.name?.trim() !== expectedName || targetLeaf !== true || parentsWithChildren.has(id)) return null;

    const ids: string[] = [];
    const names: string[] = [];
    const visited = new Set<string>();
    let current: OlxCategoryNode | undefined = target;
    let depth = 0;
    while (current) {
      const currentId = String(current.id ?? '');
      const currentName = current.name?.trim();
      if (!currentId || !currentName || visited.has(currentId) || depth >= 32) return null;
      visited.add(currentId);
      ids.unshift(currentId);
      names.unshift(currentName);
      depth += 1;
      if (currentId !== id && this.leafStatus(current) !== false) return null;
      if (current.parent_id === 0) break;
      if (current.parent_id === null || current.parent_id === undefined) return null;
      const parentId = this.canonicalCategoryId(current.parent_id);
      if (!parentId) return null;
      current = byId.get(parentId);
      if (!current) return null;
    }
    return names.length > 1 ? { ids, names, validatedAtMs: graph.validatedAtMs } : null;
  }

  private async validatedFlatGraph(): Promise<OlxValidatedGraph | null> {
    const now = Date.now();
    if (this.flatGraphCache && this.flatGraphCache.expiresAt > now) return this.flatGraphCache.graph;
    if (this.flatGraphInFlight) return this.flatGraphInFlight;
    this.flatGraphInFlight = this.fetchAndValidateFlatGraph();
    try {
      const graph = await this.flatGraphInFlight;
      if (graph) {
        this.flatGraphCache = { expiresAt: now + Math.min(this.ttlMs, 5 * 60 * 1000), graph };
      }
      return graph;
    } finally {
      this.flatGraphInFlight = undefined;
    }
  }

  private async fetchAndValidateFlatGraph(): Promise<OlxValidatedGraph | null> {
    const response = await this.http.request<OlxCategoryNode[] | OlxEnvelope<OlxCategoryNode[]>>({
      method: 'GET',
      url: `${this.baseUrl}/categories`,
    });
    const value = response.data;
    const nodes = Array.isArray(value) ? value : value?.data;
    if (!Array.isArray(nodes)) return null;
    const byId = new Map<string, OlxCategoryNode>();
    for (const node of nodes) {
      const nodeId = this.canonicalCategoryId(node?.id);
      if (!nodeId || byId.has(nodeId) || !node.name?.trim() || this.leafStatus(node) === undefined) return null;
      byId.set(nodeId, node);
    }
    const parentsWithChildren = new Set<string>();
    for (const node of nodes) {
      if (node.parent_id === 0) continue;
      const parentId = this.canonicalCategoryId(node.parent_id);
      if (!parentId || !byId.has(parentId)) return null;
      parentsWithChildren.add(parentId);
    }
    for (const [nodeId, node] of byId) {
      if (this.leafStatus(node) === true && parentsWithChildren.has(nodeId)) return null;
      const visited = new Set<string>();
      let current: OlxCategoryNode | undefined = node;
      let depth = 0;
      while (current) {
        const currentId = this.canonicalCategoryId(current.id);
        if (!currentId || visited.has(currentId) || depth >= 32) return null;
        visited.add(currentId);
        depth += 1;
        if (current.parent_id === 0) break;
        const parentId = this.canonicalCategoryId(current.parent_id);
        if (!parentId) return null;
        current = byId.get(parentId);
        if (!current) return null;
      }
    }
    const validatedAtMs = this.now().getTime();
    if (!Number.isFinite(validatedAtMs)) return null;
    return { byId, parentsWithChildren, validatedAtMs };
  }

  private canonicalCategoryId(value: unknown): string | null {
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    }
    return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : null;
  }

  private leafStatus(node: OlxCategoryNode): boolean | undefined {
    if (node.leaf !== undefined && typeof node.leaf !== 'boolean') return undefined;
    if (node.is_leaf !== undefined && typeof node.is_leaf !== 'boolean') return undefined;
    if (node.children !== undefined && !Array.isArray(node.children)) return undefined;
    const explicit = node.leaf ?? node.is_leaf;
    if (typeof node.leaf === 'boolean' && typeof node.is_leaf === 'boolean' && node.leaf !== node.is_leaf) return undefined;
    if (explicit === undefined) return undefined;
    if (explicit === true && Array.isArray(node.children) && node.children.length > 0) return undefined;
    return explicit;
  }

  private samePath(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((part, index) => part === right[index]);
  }
}
