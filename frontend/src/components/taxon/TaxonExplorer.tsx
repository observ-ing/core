import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Container, Typography, Button, Drawer } from "@mui/material";
import type { TreeViewBaseItem } from "@mui/x-tree-view";
import { fetchTaxon, fetchTaxonObservations, fetchTaxonChildren } from "../../services/api";
import type { TaxonDetail, Occurrence, TaxaResult } from "../../services/types";
import { slugToName, nameToSlug } from "../../lib/taxonSlug";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useWikidataThumbnails } from "../../hooks/useWikidataThumbnails";
import { TaxonDetailPanel } from "./TaxonDetailPanel";
import { TaxonTreePanel } from "./TaxonTreePanel";
import { TaxonDetailSkeleton } from "./TaxonDetailSkeleton";

const TREE_WIDTH = 300;

interface TreeNode {
  id: string;
  name: string;
  rank: string;
  kingdom: string;
  childrenLoaded: boolean;
  childIds: string[];
}

/** Build a stable node ID from kingdom + name */
function nodeId(kingdom: string, name: string): string {
  return `${kingdom}/${name}`;
}

export interface TaxonTreeItem extends TreeViewBaseItem {
  rank: string;
  children?: TaxonTreeItem[];
}

/** Recursively build items array for RichTreeView from the node map */
function buildItems(id: string, nodes: Map<string, TreeNode>): TaxonTreeItem[] {
  const node = nodes.get(id);
  if (!node) return [];
  const children: TaxonTreeItem[] = [];
  for (const childId of node.childIds) {
    children.push(...buildItems(childId, nodes));
  }
  const item: TaxonTreeItem = {
    id: node.id,
    label: node.name,
    rank: node.rank,
  };
  if (children.length > 0) {
    item.children = children;
  }
  return [item];
}

export function TaxonExplorer() {
  const { kingdom, name, id } = useParams<{ kingdom?: string; name?: string; id?: string }>();
  const navigate = useNavigate();

  const [taxon, setTaxon] = useState<TaxonDetail | null>(null);
  const [observations, setObservations] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);

  // Tree state
  const nodesRef = useRef<Map<string, TreeNode>>(new Map());
  const [treeItems, setTreeItems] = useState<TaxonTreeItem[]>([]);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [selectedItem, setSelectedItem] = useState<string>("");
  const [loadingNodeId, setLoadingNodeId] = useState<string | null>(null);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);

  const lookupKingdom = kingdom ? slugToName(decodeURIComponent(kingdom)) : undefined;
  const lookupName = name ? slugToName(decodeURIComponent(name)) : undefined;
  const lookupId = id ? slugToName(decodeURIComponent(id)) : undefined;

  usePageTitle(taxon?.scientificName || "Taxon");

  // Wikidata thumbnail for hero image
  const heroNames = useMemo(() => (taxon ? [taxon.scientificName] : []), [taxon]);
  const heroThumbnails = useWikidataThumbnails(heroNames, 44);

  const heroUrl = useMemo(() => {
    if (!taxon) return undefined;
    if (taxon.photoUrl) return taxon.photoUrl;
    const thumb = heroThumbnails.get(taxon.scientificName);
    if (!thumb) return undefined;
    return thumb.replace(/\?width=\d+/, "?width=600");
  }, [taxon, heroThumbnails]);

  /** Merge a taxon detail's ancestors + children into the tree node map */
  const mergeIntoTree = useCallback(
    (detail: TaxonDetail) => {
      const nodes = nodesRef.current;
      const k = detail.kingdom || lookupKingdom || "";
      const ancestors = detail.ancestors ?? [];

      // Add ancestor nodes (linked parent → child along the path)
      for (let i = 0; i < ancestors.length; i++) {
        const a = ancestors[i];
        if (!a) continue;
        const aId = a.rank === "kingdom" ? a.name : nodeId(k, a.name);
        const existing = nodes.get(aId);
        const next = ancestors[i + 1];
        const nextId = next
          ? next.rank === "kingdom"
            ? next.name
            : nodeId(k, next.name)
          : nodeId(k, detail.scientificName);

        if (existing) {
          if (!existing.childIds.includes(nextId)) {
            existing.childIds.push(nextId);
          }
        } else {
          nodes.set(aId, {
            id: aId,
            name: a.name,
            rank: a.rank,
            kingdom: k,
            childrenLoaded: false,
            childIds: [nextId],
          });
        }
      }

      // Add the current taxon node
      const currentId = nodeId(k, detail.scientificName);
      const currentChildren = [
        ...new Set((detail.children ?? []).map((c) => nodeId(k, c.scientificName))),
      ];
      const existing = nodes.get(currentId);
      if (existing) {
        existing.childrenLoaded = true;
        // Merge children (union)
        for (const cid of currentChildren) {
          if (!existing.childIds.includes(cid)) {
            existing.childIds.push(cid);
          }
        }
      } else {
        nodes.set(currentId, {
          id: currentId,
          name: detail.scientificName,
          rank: detail.rank,
          kingdom: k,
          childrenLoaded: true,
          childIds: currentChildren,
        });
      }

      // Add child nodes
      for (const child of detail.children ?? []) {
        const childId = nodeId(k, child.scientificName);
        if (!nodes.has(childId)) {
          nodes.set(childId, {
            id: childId,
            name: child.scientificName,
            rank: child.rank,
            kingdom: k,
            childrenLoaded: false,
            childIds: [],
          });
        }
      }

      // Rebuild tree items from root
      const firstAncestor = ancestors[0];
      const rootId = firstAncestor
        ? firstAncestor.rank === "kingdom"
          ? firstAncestor.name
          : nodeId(k, firstAncestor.name)
        : currentId;
      setTreeItems(buildItems(rootId, nodes));

      // Expand all ancestors + current
      const expandIds = ancestors.map((a) => (a.rank === "kingdom" ? a.name : nodeId(k, a.name)));
      expandIds.push(currentId);
      setExpandedItems((prev) => {
        const set = new Set(prev);
        for (const id of expandIds) set.add(id);
        return Array.from(set);
      });

      setSelectedItem(currentId);
    },
    [lookupKingdom],
  );

  /** Add children to a parent node without rebuilding the tree (mutates nodesRef) */
  const addChildrenToNodes = useCallback((parentId: string, children: TaxaResult[]) => {
    const nodes = nodesRef.current;
    const parent = nodes.get(parentId);
    if (!parent) return;

    parent.childrenLoaded = true;
    for (const child of children) {
      const childId = nodeId(parent.kingdom, child.scientificName);
      if (!parent.childIds.includes(childId)) {
        parent.childIds.push(childId);
      }
      if (!nodes.has(childId)) {
        nodes.set(childId, {
          id: childId,
          name: child.scientificName,
          rank: child.rank,
          kingdom: parent.kingdom,
          childrenLoaded: false,
          childIds: [],
        });
      }
    }
  }, []);

  /** Find the root (a node with no parent) and rebuild treeItems from it */
  const rebuildTreeFromRoot = useCallback(() => {
    const nodes = nodesRef.current;
    const allChildIds = new Set<string>();
    for (const n of nodes.values()) {
      for (const cid of n.childIds) allChildIds.add(cid);
    }
    for (const n of nodes.values()) {
      if (!allChildIds.has(n.id)) {
        setTreeItems(buildItems(n.id, nodes));
        return;
      }
    }
  }, []);

  /** Merge lazily-loaded children into the tree (single-parent convenience) */
  const mergeChildren = useCallback(
    (parentId: string, children: TaxaResult[]) => {
      addChildrenToNodes(parentId, children);
      rebuildTreeFromRoot();
    },
    [addChildrenToNodes, rebuildTreeFromRoot],
  );

  // Fetch taxon data when URL changes
  useEffect(() => {
    if (!lookupKingdom && !lookupId) {
      setError("No taxon specified");
      setLoading(false);
      return;
    }

    // StrictMode double-fires this effect in dev, and route changes can also
    // re-fire it mid-load. A late response from a superseded run must not
    // overwrite state from the current one — guard every setState behind this
    // flag and flip it in the cleanup.
    let cancelled = false;

    async function loadTaxon() {
      setLoading(true);
      setError(null);

      // Fetch taxon + observations in parallel so we can swap both in atomically
      // once ready, instead of updating the header before observations arrive.
      const taxonPromise =
        lookupKingdom && lookupName
          ? fetchTaxon(lookupKingdom, lookupName)
          : fetchTaxon(lookupId ?? lookupKingdom ?? "");

      const obsPromise: Promise<{ occurrences: Occurrence[]; cursor?: string }> = (async () => {
        try {
          return lookupKingdom && lookupName
            ? await fetchTaxonObservations(lookupKingdom, lookupName)
            : await fetchTaxonObservations(lookupId ?? lookupKingdom ?? "");
        } catch {
          return { occurrences: [] };
        }
      })();

      let result: TaxonDetail | null;
      try {
        result = await taxonPromise;
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load taxon");
        setLoading(false);
        return;
      }

      if (cancelled) return;

      if (!result) {
        setError("Taxon not found");
        setLoading(false);
        return;
      }

      const obsResult = await obsPromise;
      if (cancelled) return;

      setTaxon(result);
      mergeIntoTree(result);
      setObservations(obsResult.occurrences);
      setCursor(obsResult.cursor);
      setHasMore(!!obsResult.cursor);
      setLoading(false);

      // Fetch siblings of each ancestor in parallel so the tree shows
      // aunts/uncles (and direct siblings of the current taxon) without
      // waiting for user interaction. Runs in the background — don't await.
      const k = result.kingdom || lookupKingdom || "";
      const ancestors = result.ancestors ?? [];
      if (ancestors.length > 0) {
        Promise.all(
          ancestors.map(async (a) => {
            const isKingdom = a.rank === "kingdom";
            const ancestorId = isKingdom ? a.name : nodeId(k, a.name);
            // Kingdom-rank ancestors are looked up with their own name as the kingdom param
            const lookupK = isKingdom ? a.name : k;
            try {
              const children = await fetchTaxonChildren(lookupK, a.name);
              return { ancestorId, children };
            } catch {
              return null;
            }
          }),
        ).then((settled) => {
          if (cancelled) return;
          for (const entry of settled) {
            if (entry) addChildrenToNodes(entry.ancestorId, entry.children);
          }
          rebuildTreeFromRoot();
        });
      }
    }

    loadTaxon();
    return () => {
      cancelled = true;
    };
  }, [lookupKingdom, lookupName, lookupId, mergeIntoTree, addChildrenToNodes, rebuildTreeFromRoot]);

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  const loadMoreObservations = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      let result;
      if (lookupKingdom && lookupName) {
        result = await fetchTaxonObservations(lookupKingdom, lookupName, cursor);
      } else {
        result = await fetchTaxonObservations(lookupId ?? lookupKingdom ?? "", undefined, cursor);
      }
      setObservations((prev) => [...prev, ...result.occurrences]);
      setCursor(result.cursor);
      setHasMore(!!result.cursor);
    } catch {
      setHasMore(false);
    }
    setLoadingMore(false);
  };

  const handleTreeSelect = (id: string) => {
    // Freeze the tree while a load is in progress so users can't start a
    // second navigation mid-fetch.
    if (loading) return;
    const node = nodesRef.current.get(id);
    if (!node) return;
    setMobileTreeOpen(false);
    if (node.rank === "kingdom") {
      navigate(`/taxon/${nameToSlug(node.name)}`);
    } else {
      navigate(`/taxon/${nameToSlug(node.kingdom)}/${nameToSlug(node.name)}`);
    }
  };

  const handleTreeExpansionToggle = async (id: string, isExpanded: boolean) => {
    if (loading) return;
    if (!isExpanded) return;
    const node = nodesRef.current.get(id);
    if (!node || node.childrenLoaded) return;

    setLoadingNodeId(id);
    try {
      const children = await fetchTaxonChildren(node.kingdom, node.name);
      mergeChildren(id, children);
    } catch {
      // Mark as loaded even on error to avoid retrying
      node.childrenLoaded = true;
    }
    setLoadingNodeId(null);
  };

  const treePanelProps = {
    items: treeItems,
    expandedItems,
    selectedItems: selectedItem,
    loadingNodeId,
    disabled: loading,
    onExpandedItemsChange: setExpandedItems,
    onSelectedItemsChange: handleTreeSelect,
    onItemExpansionToggle: handleTreeExpansionToggle,
  };

  // Only show the skeleton on the very first load. On subsequent navigations
  // we keep the current taxon visible until the new one is fully loaded, so
  // the detail panel transitions smoothly instead of flashing empty.
  if (loading && !taxon) {
    return (
      <Box sx={{ display: "flex", height: "100%", overflow: "hidden" }}>
        <Box
          sx={{
            width: TREE_WIDTH,
            minWidth: TREE_WIDTH,
            borderRight: 1,
            borderColor: "divider",
            display: { xs: "none", md: "block" },
          }}
        />
        <Box sx={{ flex: 1, overflow: "auto" }}>
          <TaxonDetailSkeleton />
        </Box>
      </Box>
    );
  }

  if (error || !taxon) {
    return (
      <Container maxWidth="md" sx={{ p: 4, textAlign: "center" }}>
        <Typography color="error" sx={{ mb: 2 }}>
          {error || "Taxon not found"}
        </Typography>
        <Button variant="outlined" onClick={handleBack}>
          Go Back
        </Button>
      </Container>
    );
  }

  return (
    <Box sx={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Desktop Tree */}
      <Box
        sx={{
          width: TREE_WIDTH,
          minWidth: TREE_WIDTH,
          borderRight: 1,
          borderColor: "divider",
          overflow: "auto",
          display: { xs: "none", md: "block" },
        }}
      >
        <TaxonTreePanel {...treePanelProps} />
      </Box>

      {/* Mobile Tree Drawer */}
      <Drawer
        anchor="left"
        open={mobileTreeOpen}
        onClose={() => setMobileTreeOpen(false)}
        sx={{ display: { md: "none" } }}
        slotProps={{ paper: { sx: { width: TREE_WIDTH } } }}
      >
        <TaxonTreePanel {...treePanelProps} />
      </Drawer>

      {/* Detail Panel */}
      <TaxonDetailPanel
        taxon={taxon}
        heroUrl={heroUrl}
        observations={observations}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadMoreObservations}
        onBack={handleBack}
        onToggleTree={() => setMobileTreeOpen(true)}
      />
    </Box>
  );
}
