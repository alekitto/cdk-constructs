import { AssetStaging, BundlingOptions, DockerVolume, aws_lambda as lambda, aws_s3_assets as s3_assets } from 'aws-cdk-lib';
import { SpawnSyncOptions, spawnSync } from 'child_process';
import { makeUniqueId } from '../util/uniqueid';

function flatten(x: string[][]) {
    return Array.prototype.concat([], ...x);
}

function dockerExec(args: string[], options?: SpawnSyncOptions) {
    const prog = process.env.CDK_DOCKER ?? 'docker';
    const proc = spawnSync(prog, args, options);

    if (proc.error) {
        throw proc.error;
    }

    if (0 !== proc.status) {
        if (proc.stdout || proc.stderr) {
            throw new Error(`[Status ${proc.status}] stdout: ${proc.stdout?.toString().trim()}\n\n\nstderr: ${proc.stderr?.toString().trim()}`);
        }
        throw new Error(`${prog} exited with status ${proc.status}`);
    }

    return proc;
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

                    let inputVolume: any;
                    let outputVolume: any;

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
                    const dockerArgs = [
                        'run', '--rm',
                        ...options.user
                            ? [ '-u', options.user ]
                            : [],
                        ...flatten(dockerVolumes.map(v => {
                            return [ '-v', `${v.volumeName}:${v.volume.containerPath}` ];
                        })),
                        ...flatten(Object.entries(environment).map(([ k, v ]) => [ '--env', `${k}=${v}` ])),
                        '-w', inputVolume!.volume.containerPath,
                        options.image.toJSON(),
                        ...command,
                    ];

                    dockerExec(dockerArgs);

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
}
