import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export class CognitoStack extends cdk.Stack {
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Step 1: Create IAM Role for SNS Publishing with external ID and trust relationship for Cognito
    const poolSnsRoleExternalId = "CognitoSMSMFA";
    const poolSnsRole = new iam.Role(this, "UserPoolSnsRole", {
      externalIds: [poolSnsRoleExternalId],
      assumedBy: new iam.ServicePrincipal("cognito-idp.amazonaws.com"),
      inlinePolicies: {
        snsPublishPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["sns:Publish"],
              resources: [
                "*", // TODO: Remove '*' once you have specific ARN
              ],
            }),
          ],
        }),
      },
    });

    // Ensure the role has the trust relationship for Cognito to assume it
    poolSnsRole.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        principals: [new iam.ServicePrincipal("cognito-idp.amazonaws.com")],
      })
    );

    // Step 2: Create Cognito User Pool with SMS-based login and phone number as sign-in alias
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "nestjs-user-pool",
      selfSignUpEnabled: true,
      signInAliases: { phone: true },
      autoVerify: { phone: true },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: true,
        otp: false,
        email: false,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      smsRole: poolSnsRole,
      smsRoleExternalId: poolSnsRoleExternalId,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // TODO: Change to RETAIN in production
    });

    // Step 3: Create Cognito User Pool Client
    const userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool: userPool,
      generateSecret: false,
      authFlows: {
        userPassword: true,
      },
      idTokenValidity: cdk.Duration.hours(24),
      accessTokenValidity: cdk.Duration.hours(24),
      refreshTokenValidity: cdk.Duration.days(365 * 10),
    });

    // Output User Pool and Client IDs
    this.userPoolId = userPool.userPoolId;
    this.userPoolClientId = userPoolClient.userPoolClientId;
  }
}
