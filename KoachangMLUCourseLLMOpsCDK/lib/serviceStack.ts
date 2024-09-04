import { HydraTestRunResources } from '@amzn/hydra';
import {
  BrazilPackage,
  DeploymentEnvironment,
  DeploymentStack,
  HydraTestApprovalWorkflowStep,
  LambdaAsset,
  Platform,
  SoftwareType,
} from '@amzn/pipelines';
import { CfnOutput, Duration, Fn, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Alarm, ComparisonOperator, MathExpression, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import {
  AdotLambdaExecWrapper,
  AdotLambdaLayerPythonSdkVersion,
  AdotLayerVersion,
  Alias,
  Function,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { ILambdaDeploymentConfig, LambdaDeploymentConfig, LambdaDeploymentGroup } from 'aws-cdk-lib/aws-codedeploy';
import {
  AccessLogFormat,
  AuthorizationType,
  LambdaIntegration,
  LogGroupLogDestination,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { CfnIndex } from 'aws-cdk-lib/aws-kendra';
import { Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnGuardrail, CfnGuardrailVersion } from 'aws-cdk-lib/aws-bedrock';

interface ServiceStackProps {
  readonly env: DeploymentEnvironment;
  readonly stage: string;
  /**
   * Whether or not the Lambda function will serve customer traffic.
   * Monitoring and deployment configurations will be more conservative
   * when this flag is set to true.
   *
   * @default - false
   */
  readonly isProd: boolean;

  /**
   * Whether the Lambda function should be deployed gradually. Gradual deployment is highly
   * recommended for production but can slow down the development or testing workflow. Set
   * this prop to `false` if you want CDK hotswap to work.
   *
   * @default - gradual deployment is enabled by default.
   */
  readonly enableGradualDeployment?: boolean;

  /**
   * The Kendra index that holds the searchable documents.
   */
  readonly kendraIndex: CfnIndex;

  /**
   * Whether instrumentation should be enabled in the Lambda function. Automatic instrumentation has
   * a notable impact on startup time on AWS Lambda. Avoid enabling it in production environments
   * if you don't configure provisioned concurrency or your cold-start time is too close to 10 seconds.
   *
   * @default - false, instrumentation is disabled by default.
   */
  readonly enableInstrumentation?: boolean;
}

export class ServiceStack extends DeploymentStack {
  readonly env: DeploymentEnvironment;
  readonly stage: string;
  readonly hydraResources: HydraTestRunResources;
  // eslint-disable-next-line @typescript-eslint/ban-types
  readonly lambdaFunction: Function;
  readonly restApi: RestApi;

  private readonly lambdaFunctionAlias: Alias;

  // Pipelines will inject a boolean value into a stack parameter that
  // can be examined to determine if a deployment is a rollback. This
  // enables one to deploy more aggressively during a rollback [e.g.,
  // to ignore alarms or disable incremental deployment]. To do so
  // requires one to select a value for these settings at deploy-time,
  // by using a CloudFormation conditional expression.
  private readonly ifRollback = <T extends string>(then: T, otherwise: T): T =>
    Fn.conditionIf(this.pipelinesRollbackCondition.logicalId, then, otherwise).toString() as T;

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { env: props.env, softwareType: SoftwareType.LONG_RUNNING_SERVICE });
    this.stage = props.stage;
    const enableGradualDeployment = props.enableGradualDeployment ?? true;

    const guardrail = new CfnGuardrail(this, 'GuardRail', {
      name: 'KoachangMLUCourseLLMOpsGuardrail',
      blockedInputMessaging: 'PROMPT_INPUT_BLOCKED',
      blockedOutputsMessaging: 'MODEL_OUTPUT_BLOCKED',
      contentPolicyConfig: {
        filtersConfig: [
          {
            type: 'PROMPT_ATTACK',
            inputStrength: 'HIGH',
            outputStrength: 'NONE',
          },
        ],
      },
      sensitiveInformationPolicyConfig: {
        // See full list of supported entities:
        // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-bedrock-guardrail-piientityconfig.html#cfn-bedrock-guardrail-piientityconfig-type
        piiEntitiesConfig: [
          {
            type: 'AWS_ACCESS_KEY',
            action: 'BLOCK',
          },
          {
            type: 'AWS_SECRET_KEY',
            action: 'BLOCK',
          },
        ],
      },
    });

    const guardrailVersion = new CfnGuardrailVersion(this, 'GuardrailVersion', {
      description: 'v1',
      guardrailIdentifier: guardrail.attrGuardrailArn,
    });

    this.lambdaFunction = new Function(this, 'KoachangMLUCourseLLMOps', {
      functionName: 'KoachangMLUCourseLLMOps',
      description: `Timestamp: ${new Date().toISOString()} `,
      code: LambdaAsset.fromBrazil({
        brazilPackage: BrazilPackage.fromString('KoachangMLUCourseLLMOps-1.0'),
        componentName: 'Lambda',
        artifactFile: 'Lambda.zip',
      }),
      handler: 'koachang_mlu_course_llm_ops.lambda_handler',
      logGroup: new LogGroup(this, `KoachangMLUCourseLLMOpsLogGroup`, {
        removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
        retention: RetentionDays.TEN_YEARS,
      }),
      memorySize: 512,
      timeout: Duration.seconds(30),
      runtime: Runtime.PYTHON_3_11,
      initialPolicy: [
        new PolicyStatement({
          actions: ['kendra:Retrieve'],
          resources: [props.kendraIndex.attrArn],
        }),
        new PolicyStatement({
          actions: ['bedrock:InvokeModel'],
          resources: [
            `arn:${this.partition}:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
          ],
        }),
        new PolicyStatement({
          actions: ['bedrock:UseGuardrail', 'bedrock:ApplyGuardrail'],
          resources: [guardrail.attrGuardrailArn],
        }),
      ],
      environment: {
        KENDRA_INDEX_ID: props.kendraIndex.attrId,
        GUARDRAIL_ID: guardrail.attrGuardrailId,
        GUARDRAIL_VERSION: guardrailVersion.attrVersion,
      },
      adotInstrumentation: props.enableInstrumentation
        ? {
            layerVersion: AdotLayerVersion.fromPythonSdkLayerVersion(AdotLambdaLayerPythonSdkVersion.LATEST),
            execWrapper: AdotLambdaExecWrapper.REGULAR_HANDLER,
          }
        : undefined,
    });

    this.lambdaFunctionAlias = new Alias(this, 'KoachangMLUCourseLLMOpsFunctionAlias', {
      aliasName: 'live',
      version: this.lambdaFunction.currentVersion,
    });

    const apiGatewayRole = new Role(this, 'ApiGatewayExecutionRole', {
      assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
    });
    this.lambdaFunctionAlias.grantInvoke(apiGatewayRole);

    const apiGatewayLogGroup = new LogGroup(this, 'ApiGatewayAccessLog', {
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      retention: RetentionDays.TEN_YEARS,
    });

    this.restApi = new RestApi(this, 'RestApi', {
      defaultIntegration: new LambdaIntegration(this.lambdaFunctionAlias, {
        credentialsRole: apiGatewayRole,
      }),
      defaultMethodOptions: {
        authorizationType: AuthorizationType.IAM,
      },
      cloudWatchRole: true,
      deployOptions: {
        stageName: 'live',
        // DataTraceEnabled logging option should be disabled by default
        // since it would capture full request response data in the logs.
        // This might result in leaking sensitive customer data in the logs.
        dataTraceEnabled: false,
        // Enable tracing to support AWS X-Ray.
        tracingEnabled: true,
        // Required to enable CloudWatch metrics.
        metricsEnabled: true,
        accessLogDestination: new LogGroupLogDestination(apiGatewayLogGroup),
        accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
      },
    });
    this.restApi.root.addProxy();

    // Create auto-scaling target
    const autoScaling = this.lambdaFunctionAlias.addAutoScaling({ maxCapacity: 20 });

    // Configure target tracking
    autoScaling.scaleOnUtilization({ utilizationTarget: 0.5 });

    if (enableGradualDeployment) {
      // Non-prod stages may have zero traffic and may block deployment unnecessarily, thus
      // we only apply overall success rate alarm in prod.
      this.addGradualDeployment(props.isProd);
    }

    this.hydraResources = new HydraTestRunResources(this, 'HydraTestRunResources', {
      hydraEnvironment: props.env.hydraEnvironment,
      hydraAsset: {
        targetPackage: BrazilPackage.fromString('KoachangMLUCourseLLMOpsTests-1.0'),
      },
    });

    this.hydraResources.invocationRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('AmazonAPIGatewayInvokeFullAccess'),
    );
    this.hydraResources.invocationRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('AWSCloudFormationReadOnlyAccess'),
    );

    this.hydraResources.invocationRole.addToPolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        effect: Effect.ALLOW,
        resources: [
          `arn:${this.partition}:bedrock:${this.region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
        ],
      }),
    );

    new CfnOutput(this, 'KoachangMLUCourseLLMOps-ApiUrl', {
      exportName: 'KoachangMLUCourseLLMOps-ApiUrl',
      value: this.restApi.url,
    });
  }

  private addGradualDeployment(isProd: boolean) {
    /*
     * Configuring incremental deployment with rollback rule. The rule is to rollback when one of
     * the following conditions is true:
     *   * The success rate of the new version of your Lambda function is below 95%.
     *   * The overall success rate of your Lambda function is below 99%.
     */
    const newFunctionVersionSuccessRateMetric = new MathExpression({
      label: 'Success Rate',
      expression: '100 - 100*error/invocations',
      period: Duration.minutes(1),
      usingMetrics: {
        error: this.lambdaFunction.metricErrors({
          dimensionsMap: {
            FunctionName: this.lambdaFunction.functionName,
            ExecutedVersion: this.lambdaFunction.currentVersion.version,
            Resource: `${this.lambdaFunction.functionName}:${this.lambdaFunctionAlias.aliasName}`,
          },
        }),
        invocations: this.lambdaFunction.metricInvocations({
          dimensionsMap: {
            FunctionName: this.lambdaFunction.functionName,
            ExecutedVersion: this.lambdaFunction.currentVersion.version,
            Resource: `${this.lambdaFunction.functionName}:${this.lambdaFunctionAlias.aliasName}`,
          },
        }),
      },
    });

    const overallFunctionSuccessRateMetric = new MathExpression({
      label: 'Success Rate',
      expression: '100 - 100*error/invocations',
      period: Duration.minutes(1),
      usingMetrics: {
        error: this.lambdaFunctionAlias.metricErrors(),
        invocations: this.lambdaFunctionAlias.metricInvocations(),
      },
    });

    // Define alarms
    const newFunctionSuccessRateAlarm = new Alarm(this, 'NewFunctionSuccessRateAlarm', {
      threshold: 95,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      metric: newFunctionVersionSuccessRateMetric,
      // New version may have low or even no traffic to begin with,
      // it might be unsafe to consider missing data as breaching.
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    const overallFunctionSuccessRateAlarm = new Alarm(this, 'OverallFunctionSuccessRateAlarm', {
      threshold: 99,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      metric: overallFunctionSuccessRateMetric,
      treatMissingData: TreatMissingData.BREACHING,
    });

    // Non-prod stages may have zero traffic and may block deployment unnecessarily, thus
    // we only apply overall success rate alarm in prod.
    const alarms = [newFunctionSuccessRateAlarm];
    if (isProd) {
      alarms.push(overallFunctionSuccessRateAlarm);
    }

    // Putting the deployment configuration and alarms together
    new LambdaDeploymentGroup(this, 'KoachangMLUCourseLLMOpsDeploymentGroup', {
      alias: this.lambdaFunctionAlias,
      deploymentConfig: this.createDeploymentConfig(isProd),
      alarms,
    });
  }

  private createDeploymentConfig(isProd: boolean): ILambdaDeploymentConfig {
    const deploymentConfiguration = isProd
      ? LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES
      : LambdaDeploymentConfig.ALL_AT_ONCE;
    const rollbackDeploymentConfiguration = LambdaDeploymentConfig.ALL_AT_ONCE;

    // Support in CDK for CloudFormation conditional expressions is limited to simple
    // types. Thus, we condition the value of each attribute of a single shape,
    // instead of conditionally returning one of two shapes.
    // See https://github.com/aws/aws-cdk/issues/8396
    return {
      deploymentConfigName: this.ifRollback(
        rollbackDeploymentConfiguration.deploymentConfigName,
        deploymentConfiguration.deploymentConfigName,
      ),
      deploymentConfigArn: this.ifRollback(
        rollbackDeploymentConfiguration.deploymentConfigArn,
        deploymentConfiguration.deploymentConfigArn,
      ),
    };
  }

  // Integration test workflow hydra definition
  createIntegrationTestsApprovalWorkflowStep(
    name: string,
    versionSetPlatform: Platform,
  ): HydraTestApprovalWorkflowStep {
    // Hydra Test Run Definition, which defines parameters to run the test step.
    // See: https://w.amazon.com/bin/view/HydraTestPlatform/RunDefinition/
    return this.hydraResources.createApprovalWorkflowStep({
      name: name,
      // Hydra Test Run Definition, which defines parameters to run the test step.
      // See: https://builderhub.corp.amazon.com/docs/hydra/user-guide/concepts-run-definition.html
      runDefinition: {
        SchemaVersion: '1.0',
        SchemaType: 'HydraCustom',
        HydraParameters: {
          Runtime: 'python3.12',
          Handler: 'hydra_test_platform_pytest.lambda_handler.handler',
          ComputeEngine: 'Lambda',
        },
        HandlerParameters: {
          PythonTestPackage: 'koachang_mlu_course_llm_ops_tests',
        },
        EnvironmentVariables: {
          Stage: this.stage,
        },
      },
      versionSetPlatform: versionSetPlatform,
    });
  }
}
