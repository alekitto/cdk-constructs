import { DockerBuildOptions as BaseOptions } from 'aws-cdk-lib/core/lib/bundling';
import { CacheExport } from './cache-export';
import { CacheImport } from './cache-import';
import { FingerprintOptions } from 'aws-cdk-lib';

export interface DockerBuildOptions extends BaseOptions {
    fingerprintOptions?: FingerprintOptions;
    cache?: {
        from?: CacheImport[];
        to?: CacheExport[];
    };
}
