export enum CacheExportType {
    GitHubActions = 'gha',
    Registry = 'registry',
    Local = 'local',
    Inline = 'inline',
    S3 = 's3',
}

interface CacheExportInterface {
    type: CacheExportType;
    mode?: 'min' | 'max';
}

interface InlineCacheExport extends CacheExportInterface {
    type: CacheExportType.Inline;
}

interface GhaCacheExport extends CacheExportInterface {
    type: CacheExportType.GitHubActions;
    url?: string;
    token?: string;
    scope?: string;
}

interface RegistryOrLocalCacheExport extends CacheExportInterface {
    type: CacheExportType.Registry | CacheExportType.Local;
    destination: string;
    ociMediatypes?: boolean;
    imageManifest?: boolean;
    compression?: {
        type?: 'uncompressed' | 'gzip' | 'estargz' | 'zstd';
        level?: number;
        force?: boolean;
    };
}

interface S3CacheExport extends CacheExportInterface {
    type: CacheExportType.S3;
    bucket?: string;
    region?: string;
    blobsPrefix?: string;
    manifestsPrefix?: string;
    endpointUrl?: string;
    usePathStyle?: boolean;
    prefix?: string;
    name?: string;
}

export type CacheExport = RegistryOrLocalCacheExport | GhaCacheExport | S3CacheExport | InlineCacheExport;
export function renderCacheExport(cache: CacheExport): string {
    const attrs = ['type=' + cache.type];
    switch (cache.type) {
        case CacheExportType.GitHubActions: {
            attrs.push(
                ...(cache.mode ? [ 'mode=' + cache.mode ] : []),
                ...(cache.url ? [ 'url=' + cache.url ] : []),
                ...(cache.token ? [ 'token=' + cache.token ] : []),
                ...(cache.scope ? [ 'scope=' + cache.scope ] : []),
            );
        } break;

        case CacheExportType.Registry:
        case CacheExportType.Local: {
            attrs.push(
                ...(cache.mode && cache.type === CacheExportType.Registry ? [ 'mode=' + cache.mode ] : []),
                ...(cache.destination ? [ (cache.type === CacheExportType.Local ? 'dest=' : 'ref=') + cache.destination ] : []),
                ...(cache.ociMediatypes ? [ 'oci-mediatypes=' + JSON.stringify(cache.ociMediatypes) ] : []),
                ...(cache.imageManifest ? [ 'image-manifest=' + JSON.stringify(cache.imageManifest) ] : []),
                ...(cache.compression?.type ? [ 'compression=' + cache.compression.type ] : []),
                ...(cache.compression?.level ? [ 'compression-level=' + cache.compression.level ] : []),
                ...(cache.compression?.force ? [ 'force-compression=' + JSON.stringify(cache.compression.force) ] : []),
            );
        } break;

        case CacheExportType.S3: {
            attrs.push(
                ...(cache.mode ? [ 'mode=' + cache.mode ] : []),
                ...(cache.bucket ? [ 'bucket=' + cache.bucket ] : []),
                ...(cache.region ? [ 'region=' + cache.region ] : []),
                ...(cache.blobsPrefix ? [ 'blobs_prefix=' + cache.blobsPrefix ] : []),
                ...(cache.manifestsPrefix ? [ 'manifests_prefix=' + cache.manifestsPrefix ] : []),
                ...(cache.endpointUrl ? [ 'endpoint_url=' + cache.endpointUrl ] : []),
                ...(cache.usePathStyle ? [ 'use_path_style=' + cache.usePathStyle ] : []),
                ...(cache.prefix ? [ 'prefix=' + cache.prefix ] : []),
                ...(cache.name ? [ 'name=' + cache.name ] : []),
            );
        } break;
    }

    return '--cache-to=' + attrs.join(',');
}
