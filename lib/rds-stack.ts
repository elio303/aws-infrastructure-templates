import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";

export class RdsStack extends cdk.Stack {
  public readonly rdsInstance: rds.DatabaseInstance;
  public readonly rdsProxy: rds.DatabaseProxy;
  public readonly rdsSecret: rds.DatabaseSecret;
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

    const proxySecurityGroup = new ec2.SecurityGroup(
      this,
      "ProxySecurityGroup",
      {
        vpc,
        allowAllOutbound: true,
      }
    );

    const rdsSecurityGroup = new ec2.SecurityGroup(this, "RdsSecurityGroup", {
      vpc,
      allowAllOutbound: true,
    });

    // Only allow inbound traffic from the Proxy Security Group
    rdsSecurityGroup.addIngressRule(
      proxySecurityGroup,
      ec2.Port.tcp(5432),
      "Allow inbound traffic to RDS from Proxy"
    );

    const engine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_17_2,
    });

    this.rdsSecret = new rds.DatabaseSecret(this, "DBSecret", {
      username: dbUser,
    });

    // Create RDS Instance in an ISOLATED subnet
    this.rdsInstance = new rds.DatabaseInstance(this, "MyPostgresDatabase", {
      engine,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED, // Isolated subnet for RDS
      },
      // parameterGroup: this.disableSslParameterGroup(engine),
      securityGroups: [rdsSecurityGroup],
      credentials: rds.Credentials.fromSecret(this.rdsSecret),
      allocatedStorage: 20,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      publiclyAccessible: false,
      databaseName: this.dbName,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // WARNING: Deletes DB when stack is removed
    });

    // Allow inbound connections from anywhere (or restrict this to Lambda IPs if needed)
    proxySecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      "Allow external traffic to RDS Proxy"
    );

    // Allow RDS Proxy to talk to RDS Instance
    rdsSecurityGroup.addIngressRule(
      proxySecurityGroup,
      ec2.Port.tcp(5432),
      "Allow Proxy to access RDS"
    );

    // IAM Role for Proxy
    const proxyRole = new iam.Role(this, "RdsProxyRole", {
      assumedBy: new iam.ServicePrincipal("rds.amazonaws.com"),
    });

    proxyRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonRDSFullAccess")
    );

    this.rdsInstance.secret?.grantRead(proxyRole);

    // Create RDS Proxy in a PUBLIC subnet
    this.rdsProxy = new rds.DatabaseProxy(this, "RdsProxyInstance", {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      proxyTarget: rds.ProxyTarget.fromInstance(this.rdsInstance),
      secrets: [this.rdsSecret],
      securityGroups: [proxySecurityGroup],
      iamAuth: true,
      debugLogging: true,
    });
  }

  private disableSslParameterGroup = (engine: rds.IInstanceEngine) =>
    new rds.ParameterGroup(this, "DisableSsl", {
      engine,
      parameters: { "rds.force_ssl": "0" },
    });
}
