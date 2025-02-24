import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipelineActions from "aws-cdk-lib/aws-codepipeline-actions";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as lambda from "aws-cdk-lib/aws-lambda";

export class PipelineStack extends cdk.Stack {
  constructor(
    scope: cdk.App,
    id: string,
    props: cdk.StackProps & {
      lambdaBucket: s3.Bucket;
      lambdaFunction: lambda.Function;
      migrationLambdaFunction: lambda.Function;
      cleanUpLambdaFunction: lambda.Function;
    }
  ) {
    super(scope, id, props);

    const {
      lambdaBucket,
      lambdaFunction,
      migrationLambdaFunction,
      cleanUpLambdaFunction,
    } = props;

    const sourceArtifact = new codepipeline.Artifact();
    const sourceAction = new codepipelineActions.GitHubSourceAction({
      actionName: "GitHubSource",
      owner: process.env.GITHUB_USERNAME || "",
      repo: process.env.GITHUB_REPOSITORY || "",
      branch: process.env.GITHUB_BRANCH,
      oauthToken: cdk.SecretValue.secretsManager("github-pat"),
      output: sourceArtifact,
      trigger: codepipelineActions.GitHubTrigger.WEBHOOK,
    });

    const buildAndUploadAction = this.uploadRepoCodeToS3Action(
      lambdaBucket,
      sourceArtifact
    );

    const uploadMigrationCodeAction = this.uploadBucketCodeToLambdaAction(
      lambdaBucket,
      migrationLambdaFunction,
      "UploadMigrationCodeToLambda",
      sourceArtifact
    );

    const invokeMigrationLambdaAction =
      new codepipelineActions.LambdaInvokeAction({
        actionName: "InvokeMigrationLambda",
        lambda: migrationLambdaFunction,
      });

    const uploadAppCodeAction = this.uploadBucketCodeToLambdaAction(
      lambdaBucket,
      lambdaFunction,
      "UploadAppCodeToLambda",
      sourceArtifact
    );

    const uploadCleanUpCodeAction = this.uploadBucketCodeToLambdaAction(
      lambdaBucket,
      cleanUpLambdaFunction,
      "UploadCleanUpCodeToLambda",
      sourceArtifact
    );

    const pipeline = new codepipeline.Pipeline(this, "NestJsPipeline", {
      pipelineName: "NestJsPipeline",
      stages: [
        {
          stageName: "Fetch_Code",
          actions: [sourceAction],
        },
        {
          stageName: "Build_Code",
          actions: [buildAndUploadAction],
        },
        {
          stageName: "Upload_Migration_Code",
          actions: [uploadMigrationCodeAction],
        },
        {
          stageName: "Run_Migrations",
          actions: [invokeMigrationLambdaAction],
        },
        {
          stageName: "Upload_App_Code",
          actions: [uploadAppCodeAction],
        },
        {
          stageName: "Upload_Clean_Up_Code",
          actions: [uploadCleanUpCodeAction],
        },
      ],
    });

    migrationLambdaFunction.grantInvoke(pipeline.role!);
  }

  uploadRepoCodeToS3Action = (
    lambdaBucket: s3.Bucket,
    sourceArtifact: codepipeline.Artifact
  ) => {
    const project = new codebuild.PipelineProject(this, "BuildProject", {
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_5,
      },
      environmentVariables: {
        LAMBDA_BUCKET_NAME: { value: lambdaBucket.bucketName },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            commands: ["npm i --omit=dev"],
          },
          build: {
            commands: [
              "npm run build",
              "npm run build:migrate",
              "npm run build:cleanup",
              "npm run build:transform",
              "node dist/transform.js",
              "mv dist/lambda.js ./",
              "mv dist/migrate.js ./",
              "mv dist/cleanup.js ./",
              "mv dist/migrations ./",
              "zip -r lambda.zip lambda.js migrate.js cleanup.js node_modules package.json package-lock.json migrations",
              "aws s3 cp lambda.zip s3://$LAMBDA_BUCKET_NAME/lambda.zip",
            ],
          },
        },
        artifacts: {
          files: ["lambda.zip"],
        },
      }),
    });
    lambdaBucket.grantReadWrite(project);
    return new codepipelineActions.CodeBuildAction({
      actionName: "BuildCodeAndUpload",
      project: project,
      input: sourceArtifact,
    });
  };

  uploadBucketCodeToLambdaAction = (
    lambdaBucket: s3.Bucket,
    lambdaFunction: lambda.Function,
    label: string,
    input: codepipeline.Artifact
  ) => {
    const project = new codebuild.PipelineProject(this, `${label}Project`, {
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_5,
      },
      environmentVariables: {
        LAMBDA_BUCKET_NAME: { value: lambdaBucket.bucketName },
        LAMBDA_FUNCTION_NAME: { value: lambdaFunction.functionName },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          build: {
            commands: [
              "aws lambda update-function-code --function-name $LAMBDA_FUNCTION_NAME --s3-bucket $LAMBDA_BUCKET_NAME --s3-key lambda.zip",
            ],
          },
        },
      }),
    });
    lambdaBucket.grantRead(project);
    (project.role as iam.Role).addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:UpdateFunctionCode"],
        resources: [lambdaFunction.functionArn],
      })
    );

    return new codepipelineActions.CodeBuildAction({
      actionName: `${label}Action`,
      project,
      input,
    });
  };
}
