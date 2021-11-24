import { ArnFormat, Fn, IResource, Lazy, Names, Resource, Stack, aws_appmesh as appmesh } from 'aws-cdk-lib';
import { IVirtualRouter, VirtualRouter } from './virtual-router';
import { Construct } from 'constructs';
import { IMesh } from './mesh';
import { RouteSpec } from './route-spec';

/**
 * Interface for which all Route based classes MUST implement
 */
export interface IRoute extends IResource {
    /**
     * The name of the route
     *
     * @attribute
     */
    readonly routeName: string;

    /**
     * The Amazon Resource Name (ARN) for the route
     *
     * @attribute
     */
    readonly routeArn: string;

    /**
     * The VirtualRouter the Route belongs to
     */
    readonly virtualRouter: IVirtualRouter;
}

/**
 * Base interface properties for all Routes
 */
export interface RouteBaseProps {
    /**
     * The name of the route
     *
     * @default - An automatically generated name
     */
    readonly routeName?: string;

    /**
     * Protocol specific spec
     */
    readonly routeSpec: RouteSpec;
}

/**
 * Properties to define new Routes
 */
export interface RouteProps extends RouteBaseProps {
    /**
     * The service mesh to define the route in
     */
    readonly mesh: IMesh;

    /**
     * The VirtualRouter the Route belongs to
     */
    readonly virtualRouter: IVirtualRouter;
}

/**
 * Route represents a new or existing route attached to a VirtualRouter and Mesh
 *
 * @see https://docs.aws.amazon.com/app-mesh/latest/userguide/routes.html
 */
export class Route extends Resource implements IRoute {
    /**
     * Import an existing Route given an ARN
     */
    public static fromRouteArn(scope: Construct, id: string, routeArn: string): IRoute {
        return new class extends Resource implements IRoute {
            readonly routeArn = routeArn;
            readonly virtualRouter = VirtualRouter.fromVirtualRouterArn(this, 'VirtualRouter', routeArn);
            readonly routeName = Fn.select(4, Fn.split('/', Stack.of(scope).splitArn(routeArn, ArnFormat.SLASH_RESOURCE_NAME).resourceName!));
        }(scope, id);
    }

    /**
     * Import an existing Route given attributes
     */
    public static fromRouteAttributes(scope: Construct, id: string, attrs: RouteAttributes): IRoute {
        return new class extends Resource implements IRoute {
            readonly routeName = attrs.routeName;
            readonly virtualRouter = attrs.virtualRouter;
            readonly routeArn = Stack.of(this).formatArn({
                service: 'appmesh',
                resource: `mesh/${attrs.virtualRouter.mesh.meshName}/virtualRouter/${attrs.virtualRouter.virtualRouterName}/route`,
                resourceName: this.routeName,
            });
        }(scope, id);
    }

    /**
     * The name of the Route
     */
    public readonly routeName: string;

    /**
     * The Amazon Resource Name (ARN) for the route
     */
    public readonly routeArn: string;

    /**
     * The VirtualRouter the Route belongs to
     */
    public readonly virtualRouter: IVirtualRouter;

    constructor(scope: Construct, id: string, props: RouteProps) {
        super(scope, id, {
            physicalName: props.routeName || Lazy.string({ produce: () => Names.uniqueId(this) }),
        });

        this.virtualRouter = props.virtualRouter;

        const spec = props.routeSpec.bind(this);

        const route = new appmesh.CfnRoute(this, 'Resource', {
            routeName: this.physicalName,
            meshName: this.virtualRouter.mesh.meshName,
            virtualRouterName: this.virtualRouter.virtualRouterName,
            spec: {
                tcpRoute: spec.tcpRouteSpec,
                httpRoute: spec.httpRouteSpec,
                http2Route: spec.http2RouteSpec,
                grpcRoute: spec.grpcRouteSpec,
                priority: spec.priority,
            },
        });

        this.routeName = this.getResourceNameAttribute(route.attrRouteName);
        this.routeArn = this.getResourceArnAttribute(route.ref, {
            service: 'appmesh',
            resource: `mesh/${props.mesh.meshName}/virtualRouter/${props.virtualRouter.virtualRouterName}/route`,
            resourceName: this.physicalName,
        });
    }
}

/**
 * Interface with properties ncecessary to import a reusable Route
 */
export interface RouteAttributes {
    /**
     * The name of the Route
     */
    readonly routeName: string;

    /**
     * The VirtualRouter the Route belongs to
     */
    readonly virtualRouter: IVirtualRouter;
}
