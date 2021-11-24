import { Duration, aws_appmesh as appmesh } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Protocol } from './shared-interfaces';

/**
 * Properties used to define healthchecks.
 */
interface HealthCheckCommonOptions {
    /**
     * The number of consecutive successful health checks that must occur before declaring listener healthy.
     *
     * @default 2
     */
    readonly healthyThreshold?: number;

    /**
     * The time period between each health check execution.
     *
     * @default Duration.seconds(5)
     */
    readonly interval?: Duration;

    /**
     * The amount of time to wait when receiving a response from the health check.
     *
     * @default Duration.seconds(2)
     */
    readonly timeout?: Duration;

    /**
     * The number of consecutive failed health checks that must occur before declaring a listener unhealthy.
     *
     * @default - 2
     */
    readonly unhealthyThreshold?: number;
}

/**
 * Properties used to define HTTP Based healthchecks.
 */
export interface HttpHealthCheckOptions extends HealthCheckCommonOptions {
    /**
     * The destination path for the health check request.
     *
     * @default /
     */
    readonly path?: string;
}

/**
 * Properties used to define GRPC Based healthchecks.
 */
export type GrpcHealthCheckOptions = HealthCheckCommonOptions

/**
 * Properties used to define TCP Based healthchecks.
 */
export type TcpHealthCheckOptions = HealthCheckCommonOptions

/**
 * All Properties for Health Checks for mesh endpoints
 */
export interface HealthCheckConfig {
    /**
     * VirtualNode CFN configuration for Health Checks
     *
     * @default - no health checks
     */
    readonly virtualNodeHealthCheck?: appmesh.CfnVirtualNode.HealthCheckProperty;

    /**
     * VirtualGateway CFN configuration for Health Checks
     *
     * @default - no health checks
     */
    readonly virtualGatewayHealthCheck?: appmesh.CfnVirtualGateway.VirtualGatewayHealthCheckPolicyProperty;
}

/**
 * Options used for creating the Health Check object
 */
export interface HealthCheckBindOptions {
    /**
     * Port for Health Check interface
     *
     * @default - no default port is provided
     */
    readonly defaultPort?: number;
}


/**
 * Contains static factory methods for creating health checks for different protocols
 */
export abstract class HealthCheck {
    /**
     * Construct a HTTP health check
     */
    public static http(options: HttpHealthCheckOptions = {}): HealthCheck {
        return new HealthCheckImpl(Protocol.HTTP, options.healthyThreshold, options.unhealthyThreshold, options.interval, options.timeout, options.path);
    }

    /**
     * Construct a HTTP2 health check
     */
    public static http2(options: HttpHealthCheckOptions = {}): HealthCheck {
        return new HealthCheckImpl(Protocol.HTTP2, options.healthyThreshold, options.unhealthyThreshold, options.interval, options.timeout, options.path);
    }

    /**
     * Construct a GRPC health check
     */
    public static grpc(options: GrpcHealthCheckOptions = {}): HealthCheck {
        return new HealthCheckImpl(Protocol.GRPC, options.healthyThreshold, options.unhealthyThreshold, options.interval, options.timeout);
    }

    /**
     * Construct a TCP health check
     */
    public static tcp(options: TcpHealthCheckOptions = {}): HealthCheck {
        return new HealthCheckImpl(Protocol.TCP, options.healthyThreshold, options.unhealthyThreshold, options.interval, options.timeout);
    }

    /**
     * Called when the AccessLog type is initialized. Can be used to enforce
     * mutual exclusivity with future properties
     */
    public abstract bind(scope: Construct, options: HealthCheckBindOptions): HealthCheckConfig;
}

class HealthCheckImpl extends HealthCheck {
    constructor(
        private readonly protocol: Protocol,
        private readonly healthyThreshold: number = 2,
        private readonly unhealthyThreshold: number = 2,
        private readonly interval: Duration = Duration.seconds(5),
        private readonly timeout: Duration = Duration.seconds(2),
        private readonly path?: string) {
        super();
        if (2 > healthyThreshold || 10 < healthyThreshold) {
            throw new Error('healthyThreshold must be between 2 and 10');
        }

        if (2 > unhealthyThreshold || 10 < unhealthyThreshold) {
            throw new Error('unhealthyThreshold must be between 2 and 10');
        }

        if (5000 > interval.toMilliseconds() || 300_000 < interval.toMilliseconds()) {
            throw new Error('interval must be between 5 seconds and 300 seconds');
        }

        if (2000 > timeout.toMilliseconds() || 60_000 < timeout.toMilliseconds()) {
            throw new Error('timeout must be between 2 seconds and 60 seconds');
        }

        // Default to / for HTTP Health Checks
        if (path === undefined && (protocol === Protocol.HTTP || protocol === Protocol.HTTP2)) {
            this.path = '/';
        }
    }

    public bind(_scope: Construct, options: HealthCheckBindOptions): HealthCheckConfig {
        return {
            virtualNodeHealthCheck: {
                protocol: this.protocol,
                healthyThreshold: this.healthyThreshold,
                unhealthyThreshold: this.unhealthyThreshold,
                intervalMillis: this.interval.toMilliseconds(),
                timeoutMillis: this.timeout.toMilliseconds(),
                path: this.path,
                port: options.defaultPort,
            },
            virtualGatewayHealthCheck: {
                protocol: this.protocol,
                healthyThreshold: this.healthyThreshold,
                unhealthyThreshold: this.unhealthyThreshold,
                intervalMillis: this.interval.toMilliseconds(),
                timeoutMillis: this.timeout.toMilliseconds(),
                path: this.path,
                port: options.defaultPort,
            },
        };
    }

}
