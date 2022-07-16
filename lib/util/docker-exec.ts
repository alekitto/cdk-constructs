import { SpawnSyncOptions, spawnSync } from 'child_process';

export function dockerExec(args: string[], options?: SpawnSyncOptions) {
    const prog = process.env.CDK_DOCKER ?? 'docker';
    const proc = spawnSync(prog, args, options ?? {
        stdio: [ // Show Docker output
            'ignore', // Ignore stdio
            process.stderr, // Redirect stdout to stderr
            'inherit', // Inherit stderr
        ],
    });

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
