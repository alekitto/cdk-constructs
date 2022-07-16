import { FingerprintOptions } from 'aws-cdk-lib';
import { DockerBuildOptions as BaseOptions } from 'aws-cdk-lib/core/lib/bundling';
import { CacheExport } from './cache-export';
import { CacheImport } from './cache-import';

export interface DockerBuildOptions extends BaseOptions {
    fingerprintOptions?: FingerprintOptions;
    cache?: {
        from?: CacheImport[];
        to?: CacheExport[];
    };
}
