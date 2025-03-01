#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CognitoStack } from "../lib/cognito-stack";
import { LambdaStack } from "../lib/lambda-stack";
import { VpcStack } from "../lib/vpc-stack";
import { RdsStack } from "../lib/rds-stack";
import { PipelineStack } from "../lib/pipeline-stack";
import * as dotenv from "dotenv";
import { SnsStack } from "../lib/sns-stack";
import { EventBridgeStack } from "../lib/event-bridge";

const awsProfile = process.env.AWS_PROFILE || "default";
const envFilePath = `.env.${awsProfile}`;
dotenv.config({ path: envFilePath });

const app = new cdk.App();

const dbUser = process.env.DB_USER || "";

// Step 1: Create the SNS Stack
const snsStack = new SnsStack(app, "SnsStack");

// Step 2: Create the Cognito Stack
const cognitoStack = new CognitoStack(app, "CognitoStack");

// Step 3: Create the VPC stack
const vpcStack = new VpcStack(app, "VpcStack");

// Step 4: Create the RDS Stack
const rdsStack = new RdsStack(app, "RdsStack", {
  vpc: vpcStack.vpc,
  dbUser,
});

// Step 5: Create the Lambda Stack
const lambdaApiStack = new LambdaStack(app, "LambdaStack", {
  vpc: vpcStack.vpc,
  userPoolId: cognitoStack.userPoolId,
  userPoolClientId: cognitoStack.userPoolClientId,
  rdsInstance: rdsStack.rdsInstance,
  dbms: rdsStack.dbms,
  dbUser: dbUser,
  dbName: rdsStack.dbName,
  emailTopic: snsStack.emailTopic,
  platformTopic: snsStack.platformTopic,
});

// Step 6: Create Event Bridge
const eventBridgeStack = new EventBridgeStack(app, "EventBridgeStack", {
  cleanUpLambdaFunction: lambdaApiStack.cleanUpLambdaFunction,
});

// Step 7: Create the Pipeline
const pipelineStack = new PipelineStack(app, "PipelineStack", {
  lambdaBucket: lambdaApiStack.lambdaBucket,
  lambdaFunction: lambdaApiStack.lambdaFunction,
  migrationLambdaFunction: lambdaApiStack.migrationLambdaFunction,
  cleanUpLambdaFunction: lambdaApiStack.cleanUpLambdaFunction,
});
