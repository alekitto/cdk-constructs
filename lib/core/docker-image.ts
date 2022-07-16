import * as crypto from 'crypto';
import { DockerImage as BaseImage, FileSystem } from 'aws-cdk-lib';
import { isAbsolute, join } from 'path';
import { DockerBuildOptions } from './docker-build-options';
import { dockerExec } from '../util/docker-exec';
import { flatten } from '../util/flatten';
import { renderCacheExport } from './cache-export';
import { renderCacheImport } from './cache-import';

/**
 * A Docker image
 */
export class DockerImage extends BaseImage {
    /**
     * Builds a Docker image
     *
     * @param path The path to the directory containing the Docker file
     * @param options Docker build options
     */
    public static fromBuild(path: string, options: DockerBuildOptions = {}) {
        const buildArgs = options.buildArgs || {};

        if (options.file && isAbsolute(options.file)) {
            throw new Error(`"file" must be relative to the docker build directory. Got ${options.file}`);
        }

        // Image tag derived from path and build options
        const input = JSON.stringify({ path, ...options });
        const tagHash = crypto.createHash('sha256').update(input).digest('hex');
        const tag = `cdk-${tagHash}`;

        const dockerArgs: string[] = [
            'buildx', 'build', '--load', '-t', tag,
            ...(options.file ? [ '-f', join(path, options.file) ] : []),
            ...(options.platform ? [ '--platform', options.platform ] : []),
            ...(options.targetStage ? [ '--target', options.targetStage ] : []),
            ...flatten(Object.entries(buildArgs).map(([ k, v ]) => [ '--build-arg', `${k}=${v}` ])),
            ...(options.cache?.from ?? []).map(renderCacheImport),
            ...(options.cache?.to ?? []).map(renderCacheExport),
            path,
        ];

        dockerExec(dockerArgs);

        let fingerprintOptions = options.fingerprintOptions ?? {};
        delete options.fingerprintOptions;

        fingerprintOptions = {
            ...fingerprintOptions,
            extraHash: (fingerprintOptions.extraHash ?? '') + JSON.stringify(options),
        };

        // Fingerprints the directory containing the Dockerfile we're building and
        // Differentiates the fingerprint based on build arguments. We do this so
        // We can provide a stable image hash. Otherwise, the image ID will be
        // Different every time the Docker layer cache is cleared, due primarily to
        // Timestamps.
        const hash = FileSystem.fingerprint(path, fingerprintOptions);

        return new DockerImage(tag, hash);
    }

    /**
     * Reference an image on DockerHub or another online registry.
     *
     * @param image the image name
     */
    public static fromRegistry(image: string) {
        return new DockerImage(image);
    }
}
