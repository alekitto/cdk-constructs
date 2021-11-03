const { Lambda, S3 } = require('aws-sdk');

let lambda = new Lambda({ apiVersion: '2015-03-31', region: 'us-east-1' });
let s3 = new S3({ apiVersion: '2006-03-01' });

/**
 * Reads the code zip file from S3 staging bucket.
 *
 * @param {object} config
 * @param {string} config.bucketName
 * @param {string} config.objectKey
 *
 * @returns {Promise<Body>}
 */
let readFile = async (config) => {
    const obj = await s3.getObject({
        Bucket: config.bucketName,
        Key: config.objectKey,
    }).promise();

    return obj.Body;
};

const deleteFunction = FunctionName => {
    return lambda.deleteFunction({
        FunctionName,
    }).promise();
}

const updateFunction = async (FunctionName, roleArn, code, Handler, Runtime, MemorySize, Timeout) => {
    const ZipFile = await readFile(code.s3Location);

    const configuration = await lambda.updateFunctionCode({
        Code: {
            ZipFile,
        },
        FunctionName,
        Handler,
        Role: roleArn,
        Runtime,
        MemorySize,
        Timeout,
    }).promise();

    let versionResponse;
    try {
        versionResponse = await lambda.publishVersion({
            FunctionName: configuration.FunctionName,
        }).promise();
    } catch (e) {
        e.CreatedPhysicalResourceId = configuration.FunctionName;
        throw e;
    }

    return {
        FunctionName: configuration.FunctionName,
        FunctionArn: configuration.FunctionArn,
        Version: versionResponse.Version,
    };
};

const createFunction = async function (FunctionName, roleArn, code, Handler, Runtime, MemorySize, Timeout) {
    const ZipFile = await readFile(code.s3Location);

    const configuration = await lambda.createFunction({
        Code: {
            ZipFile,
        },
        FunctionName,
        Handler,
        Role: roleArn,
        Runtime,
        MemorySize,
        Timeout,
    }).promise();

    let versionResponse;
    try {
        versionResponse = await lambda.publishVersion({
            FunctionName: configuration.FunctionName,
        }).promise();
    } catch (e) {
        e.CreatedPhysicalResourceId = configuration.FunctionName;
        throw e;
    }

    return {
        FunctionName: configuration.FunctionName,
        FunctionArn: configuration.FunctionArn,
        Version: versionResponse.Version,
    };
};

exports.requestHandler = async (event, context) => {
    const responseData = {};
    let physicalResourceId;
    let configuration;

    switch (event.RequestType) {
        case 'Create':
             configuration = await createFunction(
                 event.ResourceProperties.functionName,
                 event.ResourceProperties.roleArn,
                 event.ResourceProperties.code,
                 event.ResourceProperties.handler,
                 event.ResourceProperties.runtime,
                 event.ResourceProperties.memorySize,
                 event.ResourceProperties.timeout,
             );

             responseData.FunctionArn = configuration.FunctionArn;
             responseData.Version = configuration.Version;
             physicalResourceId = configuration.FunctionName;
             break;

        case 'Update':
            configuration = await updateFunction(
                event.PhysicalResourceId,
                event.ResourceProperties.roleArn,
                event.ResourceProperties.code,
                event.ResourceProperties.handler,
                event.ResourceProperties.runtime,
                event.ResourceProperties.memorySize,
                event.ResourceProperties.timeout,
            );

            responseData.FunctionArn = configuration.FunctionArn;
            responseData.Version = configuration.Version;
            physicalResourceId = configuration.FunctionName;
            break;

        case 'Delete':
            physicalResourceId = event.PhysicalResourceId;
            if (physicalResourceId) {
                await deleteFunction(physicalResourceId);
            }
            break;

        default:
            throw new Error(`Unsupported request type ${event.RequestType}`);
    }

    console.log('Returning SUCCESS response...');
    return {
        PhysicalResourceId: physicalResourceId,
        Data: responseData,
    };
};
