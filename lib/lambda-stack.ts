import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as path from "path";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as rds from "aws-cdk-lib/aws-rds";
import * as sns from "aws-cdk-lib/aws-sns";
import * as ec2 from "aws-cdk-lib/aws-ec2";

export class LambdaStack extends cdk.Stack {
  public readonly lambdaBucket: s3.Bucket;
  public readonly lambdaFunction: lambda.Function;
  public readonly migrationLambdaFunction: lambda.Function;
  public readonly cleanUpLambdaFunction: lambda.Function;

  constructor(
    scope: cdk.App,
    id: string,
    props: cdk.StackProps & {
      vpc: ec2.Vpc;
      userPoolId: string;
      userPoolClientId: string;
      rdsInstance: rds.DatabaseInstance;
      rdsSecret: rds.DatabaseSecret;
      dbms: string;
      dbUser: string;
      dbName: string;
      emailTopic: sns.Topic;
      platformTopic: sns.ITopic;
    }
  ) {
    super(scope, id, props);

    const {
      vpc,
      userPoolId,
      userPoolClientId,
      rdsInstance,
      rdsSecret,
      dbms,
      dbUser,
      dbName,
      emailTopic,
      platformTopic,
    } = props;

    // Step 1: Create an S3 bucket to store the lambda.zip
    this.lambdaBucket = new s3.Bucket(this, "ArtifactBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Define the local path to your zipped lambda file
    const deployLambdaCode = new s3deploy.BucketDeployment(
      this,
      "DeployLambdaZip",
      {
        sources: [s3deploy.Source.asset(path.join(__dirname, "..", "assets"))],
        destinationBucket: this.lambdaBucket,
      }
    );

    // Step 2: IAM Role for Lambda
    const lambdaRole = this.createLambdaRole("LambdaExecutionRole");
    const migrationLambdaRole = this.createLambdaRole(
      "MigrationLambdaExecutionRole"
    );
    const cleanUpLambdaRole = this.createLambdaRole(
      "CleanUpLambdaExecutionRole"
    );

    this.lambdaBucket.grantReadWrite(lambdaRole);

    rdsSecret.grantRead(lambdaRole);
    rdsSecret.grantRead(migrationLambdaRole);
    rdsSecret.grantRead(cleanUpLambdaRole);

    rdsInstance.grantConnect(lambdaRole);
    rdsInstance.grantConnect(migrationLambdaRole);
    rdsInstance.grantConnect(cleanUpLambdaRole);

    emailTopic.grantPublish(lambdaRole);
    emailTopic.grantSubscribe(lambdaRole);

    this.grantRoleAccessToCognito(lambdaRole, userPoolId);
    this.grantRoleAccessToPushApplication(platformTopic, lambdaRole);

    this.grantRoleAccessToNetworkInterfaces(lambdaRole);
    this.grantRoleAccessToNetworkInterfaces(migrationLambdaRole);
    this.grantRoleAccessToNetworkInterfaces(cleanUpLambdaRole);

    migrationLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["states:SendTaskSuccess", "states:SendTaskFailure"],
        resources: ["*"],
      })
    );

    const { secret, dbInstanceEndpointPort, dbInstanceEndpointAddress } =
      rdsInstance;

    const dbPass = secret?.secretValueFromJson("password").unsafeUnwrap() || "";

    const environment = {
      COGNITO_USER_POOL_ID: userPoolId,
      COGNITO_APP_CLIENT_ID: userPoolClientId,
      DB_TYPE: dbms,
      DB_HOST: dbInstanceEndpointAddress,
      DB_PORT: dbInstanceEndpointPort,
      DB_SECRET_ARN: rdsSecret.secretArn,
      DB_USER: dbUser,
      DB_PASS: dbPass,
      DB_NAME: dbName,
      DB_SYNC: process.env.DB_SYNC || "false",
      DB_SSL: process.env.DB_SSL || "true",
      DB_LOG: process.env.DB_LOG || "false",
      BUCKET_NAME: this.lambdaBucket.bucketName,
      STACK_AWS_REGION: this.region,
      SNS_EMAIL_TOPIC_ARN: emailTopic.topicArn,
      PUSH_APP_ARN: process.env.PUSH_APP_ARN || "",
      LLM_CLIENT: process.env.LLM_CLIENT || "",
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
      ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || "",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
      OPENAI_MODEL: process.env.OPENAI_MODEL || "",
      AMPLITUDE_API_KEY: process.env.AMPLITUDE_API_KEY || "",
    };

    this.lambdaFunction = this.createLambdaFunction(
      vpc,
      lambdaRole,
      environment,
      "DeployedLambda",
      "lambda.handler"
    );
    this.migrationLambdaFunction = this.createLambdaFunction(
      vpc,
      migrationLambdaRole,
      environment,
      "MigrationLambda",
      "migrate.handler"
    );
    this.cleanUpLambdaFunction = this.createLambdaFunction(
      vpc,
      cleanUpLambdaRole,
      environment,
      "CleanUpLambda",
      "cleanup.handler"
    );

    this.lambdaFunction.node.addDependency(deployLambdaCode);
    this.migrationLambdaFunction.node.addDependency(deployLambdaCode);
    this.cleanUpLambdaFunction.node.addDependency(deployLambdaCode);

    // API Gateway Integration with Lambda
    const api = new apigateway.RestApi(this, "NestJsApi", {
      restApiName: "NestJS API",
      description: "NestJS app running in Lambda",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });
    const lambdaIntegration = new apigateway.LambdaIntegration(
      this.lambdaFunction,
      {
        proxy: true,
      }
    );
    const apiResource = api.root.addResource("api");
    const proxyResource = apiResource.addResource("{proxy+}");
    proxyResource.addMethod("ANY", lambdaIntegration); // Accepts any HTTP method (GET, POST, PUT, etc.)
  }

  private grantRoleAccessToCognito = (role: iam.Role, userPoolId: string) => {
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminUpdateUserAttributes",
          "cognito-idp:AdminInitiateAuth",
          "cognito-idp:ListUsers",
        ],
        resources: [
          `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${userPoolId}`,
        ],
      })
    );
  };

  private grantRoleAccessToNetworkInterfaces = (role: iam.Role) => {
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
        ],
        resources: ["*"],
      })
    );
  };

  private grantRoleAccessToPushApplication = (
    platformTopic: sns.ITopic,
    role: iam.Role
  ) => {
    role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "sns:CreatePlatformEndpoint",
          "sns:Publish",
          "sns:DeleteEndpoint",
          "sns:GetEndpointAttributes",
          "sns:SetEndpointAttributes",
        ],
        resources: [platformTopic.topicArn],
      })
    );
  };

  private createLambdaFunction = (
    vpc: ec2.Vpc,
    role: iam.Role,
    environment: { [key: string]: string },
    name: string,
    handler: string
  ) =>
    new lambda.Function(this, name, {
      vpc,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: handler,
      code: lambda.Code.fromBucket(this.lambdaBucket, "lambda.zip"),
      memorySize: 1024,
      timeout: cdk.Duration.minutes(2),
      role,
      environment,
    });

  private createLambdaRole = (name: string) =>
    new iam.Role(this, name, {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
    });
}
