import { AssetStaging, BundlingOptions, DockerVolume, aws_lambda as lambda, aws_s3_assets as s3_assets } from 'aws-cdk-lib';
import { DockerBuildOptions, DockerImage } from '../core';
import { dockerExec } from '../util/docker-exec';
import { flatten } from '../util/flatten';
import { makeUniqueId } from '../util/uniqueid';

interface DockerBuildAssetOptions extends lambda.DockerBuildAssetOptions, DockerBuildOptions {}
interface BundleVolume {
    volume: DockerVolume,
    volumeName: string,
}

export abstract class Code extends lambda.Code {
    static fromAsset(path: string, options?: s3_assets.AssetOptions): lambda.AssetCode {
        const bundlingOptions: BundlingOptions | undefined = options?.bundling !== undefined ? {
            local: {
                tryBundle(outputDir: string, options: BundlingOptions): boolean {
                    const dockerVolumes: {
                        volume: DockerVolume,
                        volumeName: string,
                    }[] = [];

                    let inputVolume: BundleVolume | undefined;
                    let outputVolume: BundleVolume | undefined;

                    // Always mount input and output dir
                    const volumes = [
                        {
                            hostPath: path,
                            containerPath: AssetStaging.BUNDLING_INPUT_DIR,
                        },
                        {
                            hostPath: outputDir,
                            containerPath: AssetStaging.BUNDLING_OUTPUT_DIR,
                        },
                        ...options.volumes ?? [],
                    ];

                    for (const v of volumes) {
                        const volumeName = makeUniqueId([ v.hostPath ]);
                        const volume = {
                            volume: v,
                            volumeName,
                        };

                        dockerVolumes.push(volume);
                        if (v.containerPath === AssetStaging.BUNDLING_INPUT_DIR) {
                            inputVolume = volume;
                        } else if (v.containerPath === AssetStaging.BUNDLING_OUTPUT_DIR) {
                            outputVolume = volume;
                        }

                        dockerExec([ 'volume', 'create', volumeName ]);
                    }

                    // Docker run -v asset-input:/asset-input -v asset-output:/asset-output --name helper busybox
                    const helperName = 'helper' + ~~(Math.random() * 10000000);
                    const helperContainerProc = dockerExec([
                        'run', '-d',
                        ...flatten(dockerVolumes.map(dv => [ '-v', dv.volumeName + ':' + dv.volume.containerPath ])),
                        '--name', helperName,
                        'busybox',
                        'sleep', '180',
                    ]);

                    if (helperContainerProc.error) {
                        throw helperContainerProc.error;
                    }

                    if (0 !== helperContainerProc.status) {
                        throw new Error('Bundling helper exited with status: ' + helperContainerProc.status);
                    }

                    // Docker cp <asset source> helper:/asset-input
                    dockerExec([ 'cp', inputVolume!.volume.hostPath + '/.', helperName + ':' + inputVolume!.volume.containerPath ]);

                    // Docker run --rm -v asset-input:/asset-input -v asset-output/asset-output <user command>
                    const environment = options.environment || {};
                    const command = options.command || [];

                    options.image.run({
                        command,
                        environment,
                        user: options.user,
                        volumes: dockerVolumes.map(vol => ({
                            hostPath: vol.volumeName,
                            containerPath: vol.volume.containerPath,
                        })),
                        workingDirectory: inputVolume!.volume.containerPath,
                    });

                    // Docker cp helper:/asset-output <staged bundling dir>
                    dockerExec([ 'cp', helperName + ':' + outputVolume!.volume.containerPath + '/.', outputVolume!.volume.hostPath ]);

                    // Docker rm helper
                    dockerExec([ 'rm', '--force', helperName ]);

                    // Docker rm helper
                    dockerExec([ 'volume', 'rm', ...dockerVolumes.map(v => v.volumeName) ]);

                    return true;
                },
            },
            ...options.bundling,
        } : undefined;

        return lambda.Code.fromAsset(path, { ...(options ?? {}), bundling: bundlingOptions });
    }

    /**
     * Loads the function code from an asset created by a Docker build.
     *
     * By default, the asset is expected to be located at `/asset` in the
     * image.
     *
     * @param path The path to the directory containing the Docker file
     * @param options Docker build options
     */
    static fromDockerBuild(path: string, options?: DockerBuildAssetOptions): lambda.AssetCode {
        let imagePath = options?.imagePath ?? '/asset/.';

        // Ensure imagePath ends with /. to copy the **content** at this path
        if (imagePath.endsWith('/')) {
            imagePath = `${imagePath}.`;
        } else if (!imagePath.endsWith('/.')) {
            imagePath = `${imagePath}/.`;
        }

        const assetPath = DockerImage
            .fromBuild(path, options)
            .cp(imagePath, options?.outputPath);

        return new lambda.AssetCode(assetPath);
    }
}
