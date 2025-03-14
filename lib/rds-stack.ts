import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as cdk from "aws-cdk-lib";

export class RdsStack extends cdk.Stack {
  public readonly rdsInstance: rds.DatabaseInstance;
  public readonly dbms: string = "postgres";
  public readonly dbName: string = "pgdb";

  constructor(
    scope: cdk.App,
    id: string,
    props: cdk.StackProps & {
      vpc: ec2.Vpc;
      dbUser: string;
    }
  ) {
    super(scope, id, props);

    const { vpc, dbUser } = props;

    const rdsSecurityGroup = new ec2.SecurityGroup(this, "RdsSecurityGroup", {
      vpc,
      allowAllOutbound: true,
    });

    // TODO: Limit the inbound traffic to only allowing necessary connections
    rdsSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      "Allow inbound traffic to RDS from VPC"
    );

    const engine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_17_2,
    });

    this.rdsInstance = new rds.DatabaseInstance(this, "MyPostgresDatabase", {
      engine,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      parameterGroup: this.disableSslParameterGroup(engine),
      securityGroups: [rdsSecurityGroup],
      credentials: rds.Credentials.fromGeneratedSecret(dbUser),
      allocatedStorage: 20,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      publiclyAccessible: true,
      databaseName: this.dbName,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // WARNING: This deletes the database when the stack is deleted
    });
  }

  private disableSslParameterGroup = (engine: rds.IInstanceEngine) =>
    new rds.ParameterGroup(this, "DisableSsl", {
      engine,
      parameters: { "rds.force_ssl": "0" },
    });
}
