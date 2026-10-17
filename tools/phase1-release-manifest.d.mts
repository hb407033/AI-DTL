export interface ReleaseManifestEntry {
  path: string;
  size: number;
  sha256: string;
}
export interface ReleaseManifest {
  stage: string;
  sourceHead: string;
  dirty: boolean;
  sourceFingerprint: string;
  hostPort: number;
  appBundleId: string;
  model: string;
  limitations: string[];
}
export interface ReleaseManifestOptions {
  root?: string;
  exclude?: RegExp[];
  whitelistDirs?: string[];
  whitelistFiles?: string[];
  gitHead?: string;
  dirty?: boolean;
  model?: string;
}
export declare function enumerateSourceFiles(
  root: string,
  opts?: ReleaseManifestOptions,
): Promise<string[]>;
export declare function sourceFingerprint(
  root: string,
  opts?: ReleaseManifestOptions,
): Promise<string>;
export declare function buildReleaseManifest(
  root: string,
  opts?: ReleaseManifestOptions,
): Promise<ReleaseManifest>;
