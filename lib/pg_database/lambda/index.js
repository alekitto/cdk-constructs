const rdsdata = require('@aws-sdk/client-rds-data')

exports.handler = async function (event) {
    if (event.RequestType === 'Delete') {
        return;
    }

    const SecretId = event.ResourceProperties.Secret;
    if (! SecretId) {
        throw new Error('Secret id cannot be empty');
    }

    const dbName = event.ResourceProperties.Database;
    if (! dbName || dbName === 'postgres' || typeof dbName !== 'string') {
        throw new Error('Invalid database name ' + JSON.stringify(dbName));
    }

    const client = new rdsdata.RDSDataClient({});
    const queryCommand = new rdsdata.ExecuteStatementCommand({
        database: 'postgres',
        continueAfterTimeout: true,
        includeResultMetadata: true,
        sql: 'SELECT datname FROM pg_database WHERE datname = :database_name',
        parameters: [
            { name: 'database_name', value: { stringValue: dbName } },
        ],
        resourceArn: event.ResourceProperties.ClusterArn,
        secretArn: SecretId,
    });

    const result = await client.send(queryCommand);
    if (result.records.length === 0) {
        const createCommand = new rdsdata.ExecuteStatementCommand({
            database: 'postgres',
            continueAfterTimeout: true,
            sql: 'CREATE DATABASE ' + JSON.stringify(dbName),
            resourceArn: event.ResourceProperties.ClusterArn,
            secretArn: SecretId,
        });

        await client.send(createCommand);
    }
};
