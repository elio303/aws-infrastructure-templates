# Welcome to your CDK TypeScript project

## Requirements

1. Add your GitHub PAT to AWS Secrets Manager via the 'github-pat' key

2. Copy the .env.example file and fill it with the appropriate values
`cp .env.example .env`

3. Setup your AWS account in terminal and follow the prompts
`aws configure --profile default`

4. Bootstrap CDK
`cdk bootstrap`

## Running the project

1. Deploy the infrastructure
`cdk deploy --all`

2. Verify the resources being modified and type `y` and press ENTER
