import { useQuery } from "@tanstack/react-query";

import {
  projectListDirectoryQueryOptions,
  projectReadFileQueryOptions,
} from "../lib/projectReactQuery";

const LOGO_CANDIDATES = [
  "favicon.ico",
  "favicon.png",
  "logo.png",
  "logo.svg",
  "icon.png",
];

function resolveLogoCandidate(
  entries: ReadonlyArray<{ path: string; kind: string }>,
): string | null {
  const entryPaths = new Set(entries.map((entry) => entry.path));
  for (const candidate of LOGO_CANDIDATES) {
    if (entryPaths.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function mimeTypeFromPath(path: string): string {
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "image/png";
}

export function useWorkspaceLogo(workspaceRoot: string | null): {
  logoUrl: string | null;
} {
  const directoryQuery = useQuery(
    projectListDirectoryQueryOptions({
      cwd: workspaceRoot,
      directoryPath: "",
      enabled: Boolean(workspaceRoot),
      staleTime: 5 * 60 * 1000,
    }),
  );

  const logoCandidate = directoryQuery.data
    ? resolveLogoCandidate(directoryQuery.data.entries)
    : null;

  const fileQuery = useQuery(
    projectReadFileQueryOptions({
      cwd: workspaceRoot,
      relativePath: logoCandidate,
      enabled: Boolean(workspaceRoot && logoCandidate),
      staleTime: 5 * 60 * 1000,
    }),
  );

  if (!logoCandidate || !fileQuery.data) {
    return { logoUrl: null };
  }

  const { contents, isBinary, sizeBytes } = fileQuery.data;
  if (!contents || sizeBytes === 0) {
    return { logoUrl: null };
  }

  if (isBinary) {
    const mime = mimeTypeFromPath(logoCandidate);
    return { logoUrl: `data:${mime};base64,${contents}` };
  }

  // SVG files are returned as text.
  if (logoCandidate.endsWith(".svg")) {
    return {
      logoUrl: `data:image/svg+xml;base64,${btoa(contents)}`,
    };
  }

  return { logoUrl: null };
}
