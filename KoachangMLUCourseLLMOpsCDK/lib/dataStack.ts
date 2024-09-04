import { BrazilFarmArtifacts, DeploymentEnvironment, DeploymentStack, SoftwareType } from '@amzn/pipelines';
import { CustomResource, Duration, RemovalPolicy, Token } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Effect, IRole, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CfnDataSource, CfnIndex } from 'aws-cdk-lib/aws-kendra';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { BlockPublicAccess, Bucket, BucketEncryption, IBucket, StorageClass } from 'aws-cdk-lib/aws-s3';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import path = require('path');
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Provider } from 'aws-cdk-lib/custom-resources';
import * as fs from 'fs';
import { Key } from 'aws-cdk-lib/aws-kms';

export interface DataStackProps {
  readonly env: DeploymentEnvironment;
}

export class DataStack extends DeploymentStack {
  public readonly kendraIndex: CfnIndex;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, { env: props.env, softwareType: SoftwareType.LONG_RUNNING_SERVICE });

    const dataBucket = this.createDataBucket();
    const dataDeployment = this.createDataDeployment(dataBucket);
    this.kendraIndex = this.createKendraIndex();
    const docCrawlerRole = this.createKendraCrawlerRole(this.kendraIndex);
    dataBucket.grantRead(docCrawlerRole);
    const dataSource = this.createDataSource(dataBucket, docCrawlerRole);
    const kendraSyncJob = this.startKendraSyncJob(this.kendraIndex, dataSource, dataDeployment);
    this.waitForKendraSyncJob(this.kendraIndex, dataSource, kendraSyncJob.getAttString('JobExecutionId'));
  }

  createDataBucket(): IBucket {
    const accessLogsBucket = new Bucket(this, 'DatasetAccessLogsBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      versioned: true,
      lifecycleRules: [
        {
          // Log retention period is, at least, 10 years for AWS and 18 months for CDO.
          //  - https://www.aristotle.a2z.com/recommendations/57
          //  - https://skb.highcastle.a2z.com/recommendations/11
          id: 'ExpireAfterTenYears',
          enabled: true,
          expiration: Duration.days(3653),
          noncurrentVersionExpiration: Duration.days(3653),
          noncurrentVersionTransitions: [
            {
              storageClass: StorageClass.GLACIER,
              transitionAfter: Duration.days(7),
            },
          ],
        },
      ],
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });

    const kmsKey = new Key(this, 'DatasetBucketKey', {
      enableKeyRotation: true,
    });

    return new Bucket(this, 'DatasetBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'logs',
      encryption: BucketEncryption.KMS,
      encryptionKey: kmsKey,
      enforceSSL: true,
      bucketKeyEnabled: true,
    });
  }

  createDataDeployment(destinationBucket: IBucket): BucketDeployment {
    const datasetAssets = Source.asset(BrazilFarmArtifacts.fromPackage('KoachangMLUCourseLLMOpsData', 'rag'));
    return new BucketDeployment(this, 'DatasetBucketDeployment', {
      sources: [datasetAssets],
      destinationBucket,
      destinationKeyPrefix: 'rag',
    });
  }

  createKendraIndex(): CfnIndex {
    const indexRole = new Role(this, 'KendraIndexRole', {
      assumedBy: new ServicePrincipal('kendra.amazonaws.com'),
    });

    indexRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess'));

    const kmsKey = new Key(this, 'KendraIndexKey', {
      enableKeyRotation: true,
    });
    return new CfnIndex(this, 'KendraIndex', {
      name: 'KoachangMLUCourseLLMOpsIndex',
      edition: 'DEVELOPER_EDITION',
      roleArn: indexRole.roleArn,
      userContextPolicy: 'ATTRIBUTE_FILTER',
      serverSideEncryptionConfiguration: {
        kmsKeyId: kmsKey.keyId,
      },
    });
  }

  createKendraCrawlerRole(kendraIndex: CfnIndex): IRole {
    const docCrawlerRole = new Role(this, 'KendraDocCrawlerRole', {
      assumedBy: new ServicePrincipal('kendra.amazonaws.com'),
    });
    docCrawlerRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: [Token.asString(kendraIndex.getAtt('Arn'))],
        actions: ['kendra:BatchPutDocument', 'kendra:BatchDeleteDocument'],
      }),
    );
    return docCrawlerRole;
  }

  createDataSource(bucket: IBucket, role: IRole): CfnDataSource {
    return new CfnDataSource(this, 'BucketCrawler', {
      indexId: this.kendraIndex.attrId,
      name: 'S3DataSource',
      type: 'S3',
      roleArn: role.roleArn,
      dataSourceConfiguration: {
        s3Configuration: {
          bucketName: bucket.bucketName,
        },
      },
    });
  }

  getDataSetVersion(): string {
    const versionFile = BrazilFarmArtifacts.fromPackage('KoachangMLUCourseLLMOpsData', 'rag_version.txt');
    return fs.readFileSync(versionFile, { encoding: 'utf8', flag: 'r' }).trim();
  }

  startKendraSyncJob(index: CfnIndex, dataSource: CfnDataSource, bucketDeployment: BucketDeployment): CustomResource {
    const handler = new Function(this, 'KendraSyncJobStartHandler', {
      code: Code.fromAsset(path.join(__dirname, '..', 'lambda', 'kendra-data-source-sync')),
      runtime: Runtime.PYTHON_3_12,
      handler: 'index.start_kendra_job_handler',
      logGroup: new LogGroup(this, `KoachangMLUCourseLLMOps-KendraSyncJobStartHandlerLogGroup`, {
        removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
        retention: RetentionDays.TEN_YEARS,
      }),
      initialPolicy: [
        new PolicyStatement({
          actions: ['kendra:StartDataSourceSyncJob'],
          resources: [index.attrArn, index.attrArn + '/*'],
        }),
      ],
      timeout: Duration.minutes(1),
    });
    const provider = new Provider(this, 'KendraSyncJobStartCustomResourceProvider', {
      onEventHandler: handler,
      logRetention: RetentionDays.TEN_YEARS,
    });

    const customResource = new CustomResource(this, 'KendraSyncJobStart', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::StartKendraSyncJob',
      properties: {
        IndexId: index.attrId,
        DataSourceId: dataSource.attrId,
        // Only initiate a sync job if the dataset has changed. There are many ways to implement
        // this process. One way to model the dataset changes is "version" it by
        // maintaining a version string in the file "rag_version.txt" in the data package.
        // A manual version-bump is required if we need Kendra to re-index the data.
        DynamicPropToTriggerResource: `Version: ${this.getDataSetVersion()}`,
      },
    });
    // Make sure the Kendra crawling job only starts once:
    // 1. The data has been copied to the S3 bucket
    // 2. The Kendra datasource has been created
    customResource.node.addDependency(bucketDeployment);
    customResource.node.addDependency(dataSource);

    return customResource;
  }

  waitForKendraSyncJob(index: CfnIndex, dataSource: CfnDataSource, jobExecutionId: string): CustomResource {
    const handler = new Function(this, 'KendraSyncJobWaitHandler', {
      code: Code.fromAsset(path.join(__dirname, '..', 'lambda', 'kendra-data-source-sync')),
      runtime: Runtime.PYTHON_3_12,
      handler: 'index.wait_for_kendra_job_handler',
      logGroup: new LogGroup(this, `KoachangMLUCourseLLMOps-KendraSyncJobWaitHandlerLogGroup`, {
        removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
        retention: RetentionDays.TEN_YEARS,
      }),
      initialPolicy: [
        new PolicyStatement({
          actions: ['kendra:ListDataSourceSyncJobs'],
          resources: [index.attrArn, index.attrArn + '/*'],
        }),
      ],
      timeout: Duration.minutes(15),
    });
    const provider = new Provider(this, 'KendraSyncJobWaitHandlerCustomResourceProvider', {
      onEventHandler: handler,
      logRetention: RetentionDays.TEN_YEARS,
    });

    return new CustomResource(this, 'KendraSyncJobWait', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::WaitForKendraSyncJob',
      properties: {
        IndexId: index.attrId,
        DataSourceId: dataSource.attrId,
        JobExecutionId: jobExecutionId,
      },
    });
  }
}
