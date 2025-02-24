import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";

export class EventBridgeStack extends cdk.Stack {
  constructor(
    scope: cdk.App,
    id: string,
    props: cdk.StackProps & {
      cleanUpLambdaFunction: lambda.Function;
    }
  ) {
    super(scope, id, props);

    const { cleanUpLambdaFunction } = props;

    const rule = new events.Rule(this, "AutoDeclineRequestsRule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
    });

    rule.addTarget(new targets.LambdaFunction(cleanUpLambdaFunction));

    cleanUpLambdaFunction.role?.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: ["*"],
      })
    );
  }
}
