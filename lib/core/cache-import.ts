export enum CacheImportType {
    GitHubActions = 'gha',
    Registry = 'registry',
    Local = 'local',
    S3 = 's3',
}

interface CacheImportInterface {
    type: CacheImportType;
}

interface GhaCacheImport extends CacheImportInterface {
    type: CacheImportType.GitHubActions;
    url?: string;
    token?: string;
    scope?: string;
}

interface RegistryImport extends CacheImportInterface {
    type: CacheImportType.Registry;
    source: string;
}

interface LocalImport extends CacheImportInterface {
    type: CacheImportType.Local;
    source: string;
    digest?: string;
    tag?: string;
}

interface S3CacheImport extends CacheImportInterface {
    type: CacheImportType.S3;
    bucket?: string;
    region?: string;
    blobsPrefix?: string;
    manifestsPrefix?: string;
    endpointUrl?: string;
    usePathStyle?: boolean;
    prefix?: string;
    name?: string;
}

export type CacheImport = LocalImport | RegistryImport | GhaCacheImport | S3CacheImport;

export function renderCacheImport(cache: CacheImport): string {
    const attrs = ['type=' + cache.type];
    switch (cache.type) {
        case CacheImportType.GitHubActions: {
            attrs.push(
                ...(cache.url ? [ 'url=' + cache.url ] : []),
                ...(cache.token ? [ 'token=' + cache.token ] : []),
                ...(cache.scope ? [ 'scope=' + cache.scope ] : []),
            );
        } break;

        case CacheImportType.Registry: {
            attrs.push(
                ...(cache.source ? [ 'ref=' + cache.source ] : []),
            );
        } break;

        case CacheImportType.Local: {
            attrs.push(
                ...(cache.source ? [ 'src=' + cache.source ] : []),
                ...(cache.digest ? [ 'digest=' + cache.digest ] : []),
                ...(cache.tag ? [ 'tag=' + cache.tag ] : []),
            );
        } break;

        case CacheImportType.S3: {
            attrs.push(
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

    return '--cache-from=' + attrs.join(',');
}
