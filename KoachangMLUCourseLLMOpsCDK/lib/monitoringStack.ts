import { DeploymentEnvironment, DeploymentStack, SoftwareType } from '@amzn/pipelines';
import { Duration, Size } from 'aws-cdk-lib';
import { SpecRestApi } from 'aws-cdk-lib/aws-apigateway';
import {
  Alarm,
  AlarmWidget,
  ComparisonOperator,
  Dashboard,
  GaugeWidget,
  GraphWidget,
  LegendPosition,
  MathExpression,
  Metric,
  PeriodOverride,
  Stats,
  TextWidget,
  TreatMissingData,
  Unit,
} from 'aws-cdk-lib/aws-cloudwatch';
import { CfnIndex } from 'aws-cdk-lib/aws-kendra';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

interface MonitoringStackProps {
  readonly env: DeploymentEnvironment;
  readonly lambdaFunction: IFunction;
  readonly restApi: SpecRestApi;
  readonly kendraIndex: CfnIndex;
}

export class MonitoringStack extends DeploymentStack {
  constructor(scope: Construct, id: string, readonly props: MonitoringStackProps) {
    super(scope, id, { env: props.env, softwareType: SoftwareType.INFRASTRUCTURE });
    this.createSummaryDashboard();
    this.createServiceDashboard();
  }

  /**
   * Create a summary dashboard for the application with the metrics for TPS, duration, and
   * error (counts and rates).
   */
  private createSummaryDashboard() {
    const summaryDashboard = new Dashboard(this, 'SummaryDashboard', {
      dashboardName: 'KoachangMLUCourseLLMOps-Summary',
      start: '-' + Duration.days(14).toIsoString(),
      periodOverride: PeriodOverride.INHERIT,
    });

    summaryDashboard.addWidgets(
      // Header
      new TextWidget({
        width: 24,
        height: 1,
        markdown: '# Summary dashboard',
      }),
      // TPS
      new GraphWidget({
        width: 24,
        height: 6,
        title: 'TPS',
        left: [
          new MathExpression({
            expression: 'requests/PERIOD(requests)',
            usingMetrics: {
              requests: this.props.restApi.metricCount(),
            },
            label: 'AVG (1 minute)',
          }),
        ],
        leftYAxis: {
          min: 0,
          showUnits: false,
        },
      }),
      // Latency
      new GraphWidget({
        width: 24,
        height: 6,
        title: 'Latency',
        left: [
          this.props.restApi.metricLatency({
            statistic: Stats.percentile(50),
            label: 'P50',
          }),
          this.props.restApi.metricLatency({
            statistic: Stats.percentile(90),
            label: 'P90',
          }),
          this.props.restApi.metricLatency({
            statistic: Stats.percentile(99),
            label: 'P99',
          }),
        ],
        leftYAxis: {
          min: 0,
          label: 'ms',
          showUnits: false,
        },
      }),
      // Client error
      new GraphWidget({
        width: 24,
        height: 6,
        title: 'Error',
        left: [
          this.props.restApi.metricClientError({
            label: '4XX Counts',
          }),
        ],
        right: [
          new MathExpression({
            expression: 'rate*100',
            usingMetrics: {
              rate: this.props.restApi.metricClientError({
                statistic: Stats.AVERAGE,
              }),
            },
            label: '4XX Rates',
          }),
        ],
        leftYAxis: {
          min: 0,
          showUnits: false,
        },
        rightYAxis: {
          min: 0,
          label: '%',
          showUnits: false,
        },
      }),
      // Server error
      new GraphWidget({
        width: 24,
        height: 6,
        title: 'Fault',
        left: [
          this.props.restApi.metricServerError({
            label: '5XX Counts',
          }),
        ],
        right: [
          new MathExpression({
            expression: 'rate*100',
            usingMetrics: {
              rate: this.props.restApi.metricServerError({
                statistic: Stats.AVERAGE,
              }),
            },
            label: '5XX Rates',
          }),
        ],
        leftYAxis: {
          min: 0,
          showUnits: false,
        },
        rightYAxis: {
          min: 0,
          label: '%',
          showUnits: false,
        },
      }),
    );
  }

  /**
   * Create a system-level dashboard with graphs for error (counts and rates), throttle rates,
   * provisioned concurrency spillover counts, and durations. Ideally, each metric is associated
   * with an alarm. Metrics that are not associated with an alarm should be placed in a different
   * dashboard or at the bottom of this dashboard.
   *
   * The default thresholds are just the starting point based on the Golden Path recommendations,
   * they need to be adjusted accordingly as the service grows.
   * Reference: https://builderhub.corp.amazon.com/docs/native-aws/developer-guide/golden-path-lambda.html#golden-path-monitoring-and-alarms
   */
  private createServiceDashboard() {
    const serviceDashboard = new Dashboard(this, 'ServiceDashboard', {
      dashboardName: 'KoachangMLUCourseLLMOps-Service',
      start: '-' + Duration.hours(8).toIsoString(),
      periodOverride: PeriodOverride.INHERIT,
    });

    serviceDashboard.addWidgets(
      // Header
      new TextWidget({
        width: 24,
        height: 1,
        markdown: '# Service dashboard',
      }),
      new TextWidget({
        width: 24,
        height: 1,
        markdown: '## Overall',
      }),
      // Server fault
      new AlarmWidget({
        width: 12,
        height: 6,
        title: 'Fault',
        alarm: new Alarm(this, 'ApiGatewayServerFaultCountAlarm', {
          metric: this.props.restApi.metricServerError({
            period: Duration.minutes(1),
            label: '5XX Counts',
          }),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
        leftYAxis: {
          min: 0,
          showUnits: false,
        },
      }),
      new AlarmWidget({
        width: 12,
        height: 6,
        title: 'Fault',
        alarm: new Alarm(this, 'ApiGatewayServerFaultRateAlarm', {
          metric: new MathExpression({
            expression: 'rate*100',
            usingMetrics: {
              rate: this.props.restApi.metricServerError({
                statistic: Stats.AVERAGE,
                period: Duration.minutes(1),
              }),
            },
            label: '5XX Rates',
          }),
          threshold: 0.5,
          evaluationPeriods: 5,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
        leftYAxis: {
          min: 0,
          label: '%',
          showUnits: false,
        },
      }),
      // Client error
      new AlarmWidget({
        width: 12,
        height: 6,
        title: 'Error',
        alarm: new Alarm(this, 'ApiGatewayClientErrorRateAlarm', {
          metric: new MathExpression({
            expression: 'rate*100',
            usingMetrics: {
              rate: this.props.restApi.metricClientError({
                statistic: Stats.AVERAGE,
                period: Duration.minutes(1),
              }),
            },
            label: '4XX rates',
          }),
          threshold: 5,
          evaluationPeriods: 5,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
        leftYAxis: {
          min: 0,
          label: '%',
          showUnits: false,
        },
      }),
      // Header
      new TextWidget({
        width: 24,
        height: 1,
        markdown: '## Lambda function',
      }),
      // Errors
      new AlarmWidget({
        width: 12,
        height: 6,
        title: 'Error count',
        alarm: new Alarm(this, 'LambdaFunctionErrorCountAlarm', {
          metric: this.props.lambdaFunction.metricErrors({
            period: Duration.minutes(1),
          }),
          threshold: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
          evaluationPeriods: 1,
        }),
        leftYAxis: {
          min: 0,
          showUnits: false,
        },
      }),
      new AlarmWidget({
        width: 12,
        height: 6,
        title: 'Error rate',
        alarm: new Alarm(this, 'LambdaFunctionErrorRateAlarm', {
          metric: new MathExpression({
            expression: 'errors*100/invocations',
            usingMetrics: {
              errors: this.props.lambdaFunction.metricErrors(),
              invocations: this.props.lambdaFunction.metricInvocations(),
            },
            period: Duration.minutes(1),
            label: 'Rates',
          }),
          threshold: 0.5,
          evaluationPeriods: 5,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
        leftYAxis: {
          min: 0,
          label: '%',
          showUnits: false,
        },
      }),
      // Throttle
      new AlarmWidget({
        width: 12,
        height: 6,
        title: 'Throttle rate',
        alarm: new Alarm(this, 'LambdaFunctionThrottleRate', {
          metric: new MathExpression({
            expression: 'throttles*100/invocations',
            usingMetrics: {
              throttles: this.props.lambdaFunction.metricThrottles(),
              invocations: this.props.lambdaFunction.metricInvocations(),
            },
            period: Duration.minutes(1),
            label: 'Rates',
          }),
          threshold: 1,
          evaluationPeriods: 5,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
        leftYAxis: {
          min: 0,
          label: '%',
          showUnits: false,
        },
      }),
      // Duration
      new AlarmWidget({
        width: 12,
        height: 6,
        title: 'Duration',
        alarm: new Alarm(this, 'LambdaFunctionDurationAlarm', {
          metric: this.props.lambdaFunction.metricDuration({
            statistic: Stats.percentile(99),
            label: 'P99',
            period: Duration.minutes(1),
          }),
          threshold: 5000,
          evaluationPeriods: 5,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
        leftYAxis: {
          min: 0,
          label: 'ms',
          showUnits: false,
        },
      }),
      // Provisioned concurrency spillover
      new AlarmWidget({
        width: 12,
        height: 6,
        title: 'Provisioned concurrency spillover',
        alarm: new Alarm(this, 'ProvisionConcurrencySpilloverAlarm', {
          metric: this.props.lambdaFunction.metric('ProvisionedConcurrencySpilloverInvocations', {
            label: 'ProvisionedConcurrencySpilloverInvocations',
            statistic: Stats.MAXIMUM,
            period: Duration.minutes(1),
          }),
          threshold: 5,
          evaluationPeriods: 3,
          treatMissingData: TreatMissingData.NOT_BREACHING,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        }),
        leftYAxis: {
          min: 0,
          showUnits: false,
        },
      }),
      // Concurrent executions
      new GraphWidget({
        width: 12,
        height: 6,
        title: 'Concurrent executions',
        left: [
          this.props.lambdaFunction.metric('ConcurrentExecutions', {
            statistic: Stats.MAXIMUM,
            period: Duration.minutes(1),
            label: 'MAX (1 minute)',
          }),
        ],
        leftYAxis: {
          min: 0,
          showUnits: false,
        },
      }),
      // Token consumption from the lambda function
      new GraphWidget({
        width: 12,
        height: 6,
        title: 'Total token consumption from lambda function',
        left: ['TotalTokens', 'InputTokens', 'OutputTokens'].map(
          (metricName) =>
            new Metric({
              metricName,
              namespace: 'KoachangMLUCourseLLMOps',
              period: Duration.minutes(1),
              statistic: Stats.SUM,
              label: "[avg: ${AVG}, max: ${MAX}] ${PROP('MetricName')} ${PROP('Stat')}",
              dimensionsMap: {
                service: 'ApiHandler',
              },
            }),
        ),
        leftYAxis: {
          label: Unit.COUNT,
          showUnits: false,
        },
      }),
      // Average token consumption per invocation
      new GraphWidget({
        width: 12,
        height: 6,
        title: 'Average token consumption per invocation',
        left: ['TotalTokens', 'InputTokens', 'OutputTokens'].map(
          (metricName) =>
            new Metric({
              metricName,
              namespace: 'KoachangMLUCourseLLMOps',
              period: Duration.minutes(1),
              statistic: Stats.AVERAGE,
              label: "[avg: ${AVG}, max: ${MAX}] ${PROP('MetricName')} ${PROP('Stat')}",
              dimensionsMap: {
                service: 'ApiHandler',
              },
            }),
        ),
        leftYAxis: {
          label: Unit.COUNT,
          showUnits: false,
        },
      }),
    );

    // Bedrock section
    serviceDashboard.addWidgets(
      // Header
      new TextWidget({
        width: 24,
        height: 1,
        markdown: '## Bedrock',
      }),
      new AlarmWidget({
        width: 12,
        height: 6,
        title: 'Percentage of throttled invocations',
        alarm: new Alarm(this, 'BedrockInvocationThrottleRateAlarm', {
          metric: new MathExpression({
            expression: 'throttles / (throttles + invocations) * 100',
            // Bedrock Invocation metrics do not include throttled invocations
            usingMetrics: {
              invocations: new Metric({
                metricName: 'Invocations',
                namespace: 'AWS/Bedrock',
                statistic: Stats.SUM,
                label: 'InvocationCount',
              }),
              throttles: new Metric({
                metricName: 'InvocationThrottles',
                namespace: 'AWS/Bedrock',
                statistic: Stats.SUM,
                label: 'ThrottleCount',
              }),
            },
            period: Duration.minutes(5),
            label: '[max: ${MAX}%] Throttled invocations %',
          }),
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
          threshold: 5,
          evaluationPeriods: 3,
          treatMissingData: TreatMissingData.NOT_BREACHING,
        }),
        leftYAxis: {
          label: '%',
          showUnits: false,
        },
      }),
      new GraphWidget({
        width: 12,
        height: 6,
        title: 'Token count by model ID',
        left: [
          new MathExpression({
            expression:
              "SEARCH('{AWS/Bedrock, ModelId} " +
              'MetricName="InputTokenCount" OR MetricName="OutputTokenCount"\', \'Sum\')',
            usingMetrics: {},
            period: Duration.minutes(1),
            label: '[avg: ${AVG}, max: ${MAX}]',
          }),
        ],
        leftYAxis: {
          label: Unit.COUNT,
          showUnits: false,
        },
        legendPosition: LegendPosition.RIGHT,
      }),
      new GraphWidget({
        width: 12,
        height: 6,
        title: 'Invocation errors',
        left: [
          new Metric({
            metricName: 'InvocationClientErrors',
            namespace: 'AWS/Bedrock',
            period: Duration.minutes(1),
            statistic: Stats.SUM,
            label: '[max: ${MAX}] Invocation client errors',
          }),
          new Metric({
            metricName: 'InvocationServerErrors',
            namespace: 'AWS/Bedrock',
            period: Duration.minutes(1),
            statistic: Stats.SUM,
            label: '[max: ${MAX}] Invocation server errors',
          }),
        ],
        leftYAxis: {
          label: Unit.COUNT,
          showUnits: false,
        },
      }),
      new GraphWidget({
        width: 12,
        height: 6,
        title: 'Invocation count by model ID',
        left: [
          new MathExpression({
            expression: "SEARCH('{AWS/Bedrock, ModelId} MetricName=\"Invocations\"', 'Sum')",
            period: Duration.minutes(1),
            label: '[avg: ${AVG}, max: ${MAX}]',
          }),
        ],
        leftYAxis: {
          label: Unit.COUNT,
          showUnits: false,
        },
        legendPosition: LegendPosition.RIGHT,
      }),
      new GraphWidget({
        width: 12,
        height: 6,
        title: 'Latency by model ID',
        left: [
          new MathExpression({
            expression: "SEARCH('{AWS/Bedrock, ModelId} MetricName=\"InvocationLatency\"', 'p90')",
            period: Duration.minutes(1),
            label: '[avg: ${AVG}, max: ${MAX}]',
          }),
        ],
        leftYAxis: {
          label: Unit.MILLISECONDS,
          showUnits: false,
        },
        legendPosition: LegendPosition.RIGHT,
      }),
      new GraphWidget({
        width: 12,
        height: 6,
        title: 'Legacy model invocation count by model ID',
        left: [
          new MathExpression({
            expression: "SEARCH('{AWS/Bedrock, ModelId} \"LegacyModelInvocations\"', 'Sum')",
            period: Duration.minutes(1),
            label: '[last: ${LAST}] Legacy Model Invocations',
          }),
        ],
        leftYAxis: {
          label: Unit.COUNT,
          showUnits: false,
        },
      }),
    );

    // Kendra section
    const indexDocumentCount = new Metric({
      metricName: 'IndexDocumentCount',
      namespace: 'AWS/Kendra',
      statistic: Stats.AVERAGE,
      label: 'Index document count',
      dimensionsMap: {
        IndexId: this.props.kendraIndex.attrId,
      },
    });
    const provisionedIndexDocumentCount = new Metric({
      metricName: 'ProvisionedIndexDocumentCount',
      namespace: 'AWS/Kendra',
      statistic: Stats.AVERAGE,
      label: 'Provisioned index documentCount',
      dimensionsMap: {
        IndexId: this.props.kendraIndex.attrId,
      },
    });
    const indexDocumentStorageSize = new Metric({
      metricName: 'IndexDocumentStorageSize',
      namespace: 'AWS/Kendra',
      statistic: Stats.AVERAGE,
      label: 'Index document storage size',
      dimensionsMap: {
        IndexId: this.props.kendraIndex.attrId,
      },
    });
    const provisionedIndexStorageSize = new Metric({
      metricName: 'ProvisionedIndexStorageSize',
      namespace: 'AWS/Kendra',
      statistic: Stats.AVERAGE,
      label: 'Provisioned index storage size',
      dimensionsMap: {
        IndexId: this.props.kendraIndex.attrId,
      },
    });
    const indexQueryCount = new Metric({
      metricName: 'IndexQueryCount',
      namespace: 'AWS/Kendra',
      statistic: Stats.SUM,
      period: Duration.minutes(1),
      label: '[avg: ${AVG}, sum: ${SUM}] Index query count',
      dimensionsMap: {
        IndexId: this.props.kendraIndex.attrId,
      },
    });
    serviceDashboard.addWidgets(
      // Header
      new TextWidget({
        width: 24,
        height: 1,
        markdown: '## Kendra',
      }),
      new GaugeWidget({
        width: 6,
        height: 6,
        title: 'Indexed document count',
        metrics: [indexDocumentCount],
        leftYAxis: {
          // Developer Edition index supports up to 10k documents count
          // See https://aws.amazon.com/kendra/pricing/#Pricing_table
          max: 10000,
        },
      }),
      new AlarmWidget({
        width: 6,
        height: 6,
        title: 'Document count utilization',
        alarm: new Alarm(this, 'KendraIndexDocumentCountUtilization', {
          metric: new MathExpression({
            expression: 'indexDocumentCount / provisionedIndexDocumentCount * 100',
            usingMetrics: {
              indexDocumentCount,
              provisionedIndexDocumentCount,
            },
            period: Duration.minutes(5),
            label: 'Count utilization %',
          }),
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
          threshold: 90,
          evaluationPeriods: 3,
          treatMissingData: TreatMissingData.NOT_BREACHING,
        }),
        leftYAxis: {
          label: '%',
          showUnits: false,
        },
      }),
      new GaugeWidget({
        width: 6,
        height: 6,
        title: 'Indexed document size',
        metrics: [indexDocumentStorageSize],
        leftYAxis: {
          // Developer Edition index supports up to 3GiB total document size
          // See https://docs.aws.amazon.com/kendra/latest/dg/quotas.html
          max: Size.gibibytes(3).toBytes(),
        },
      }),
      new AlarmWidget({
        width: 6,
        height: 6,
        title: 'Storage size utilization',
        alarm: new Alarm(this, 'KendraIndexStorageSizeUtilization', {
          metric: new MathExpression({
            expression: 'indexDocumentStorageSize / provisionedIndexStorageSize * 100',
            usingMetrics: {
              indexDocumentStorageSize,
              provisionedIndexStorageSize,
            },
            period: Duration.minutes(5),
            label: 'Size utilization %',
          }),
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
          threshold: 90,
          evaluationPeriods: 3,
          treatMissingData: TreatMissingData.NOT_BREACHING,
        }),
        leftYAxis: {
          label: '%',
          showUnits: false,
        },
      }),
      new GaugeWidget({
        width: 6,
        height: 6,
        title: 'Index query count (1 day)',
        metrics: [
          indexQueryCount.with({
            period: Duration.days(1),
          }),
        ],
        leftYAxis: {
          // Developer Edition index supports up to 4000 queries per day
          // See https://aws.amazon.com/kendra/pricing/#Pricing_table
          max: 4000,
        },
      }),
      new GraphWidget({
        width: 6,
        height: 6,
        title: 'Index query count (1 min)',
        left: [indexQueryCount],
      }),
    );
  }
}
