import * as cdk from "aws-cdk-lib";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

export class SnsStack extends cdk.Stack {
  public readonly emailTopic: sns.Topic;
  public readonly platformTopic: sns.ITopic;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.emailTopic = new sns.Topic(this, "EmailNotificationTopic", {
      displayName: "Email Notifications Topic",
    });

    this.platformTopic = sns.Topic.fromTopicArn(
      this,
      "ExistingPlatformApp",
      process.env.PUSH_APP_ARN || ""
    );
  }
}
