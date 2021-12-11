import json
import boto3

def lambda_handler(event, context):
    instance_id = event["detail"]["instance-id"]
    state = event["detail"]["state"]

    if(isNatInstance(instance_id) and state in ["running"]):
        disableSourceDestCheck(instance_id)
        updateRouteTables(instance_id)
        msg = {'statusCode' : 200, 'body' : 'NAT configuration updated'}
    else:
        msg = {'statusCode' : 204, 'body' : 'Instance not a NAT instance, or state not in [running, pending] :  Skipping'}

    return msg

# For a single instance search the tags and see if this instance is part of a NAT(Network Address Translation) auto scaling  group.
def isNatInstance(instance_id):
    is_nat_instance = False
    ec2 = boto3.client('ec2')
    tags = ec2.describe_instances(InstanceIds=[instance_id])["Reservations"][0]["Instances"][0]["Tags"]
    for tag in tags:
        if tag["Key"] == "Name" and 'asg-nat-instance' in tag["Value"]:
            is_nat_instance = True
    return is_nat_instance

def disableSourceDestCheck(instance_id):
    ec2 = boto3.client('ec2')
    return ec2.modify_instance_attribute(InstanceId = instance_id, SourceDestCheck={"Value" : False})

def updateRouteTables(instance_id):
    ec2 = boto3.client('ec2')

    # Get the VPC that the Instance belongs to.
    vpc_id = ec2.describe_instances(InstanceIds=[instance_id])["Reservations"][0]["Instances"][0]["VpcId"]

    # Get all of the route tables that are in that VPC
    route_tables = ec2.describe_route_tables(
        Filters=[
            {
                'Name': 'vpc-id',
                'Values': [
                    vpc_id
                ]
            }
        ]
    )["RouteTables"]

    # If the "AllowNatRouteUpdate" tag is present on the route table, then we update the routes
    for route_table in route_tables:
        AllowNatRouteUpdates = [tag["Key"] for tag in route_table["Tags"] if tag["Key"]=="AllowNatRouteUpdates"]
        if AllowNatRouteUpdates:
            setPublicRoute(route_table["RouteTableId"], instance_id)
    return

def setPublicRoute(route_table_id, instance_id):
    ec2 = boto3.client('ec2')
    try:
        ec2.delete_route(
            DestinationCidrBlock='0.0.0.0/0',
            RouteTableId=route_table_id
        )
    except:
        print("route not found")

    ec2.create_route(
        DestinationCidrBlock='0.0.0.0/0',
        RouteTableId=route_table_id,
        InstanceId=instance_id
    )

    return
