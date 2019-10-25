import cdk = require('@aws-cdk/core');
import { CfnDomain } from '@aws-cdk/aws-elasticsearch';

// ステージ毎に、ノード数やデータの暗号化有無などを可変にできるように、`cdk.json`のContextを用いる。
// cdk.jsonのcontextで定義しているes contextの型定義がこのインターフェース。
interface ESContext {
  // Elasticsearchのバージョン
  readonly version: string;
  // Elasticsearch Serviceのドメイン名(クラスタ名)
  readonly domainName: string;
  // 専用マスターノードのインスタンスタイプ
  readonly masterInstanceType: string;
  // データノードのインスタンスタイプ
  readonly instanceType: string;
  // データノードのノード数
  readonly instanceCount: number;
  // ボリュームサイズ
  readonly volumeSize: number;
  // アベイラビリティゾーン数
  readonly availabilityZoneCount: 1 | 2 | 3;
  // AZ分散有無
  readonly zoneAwareness: boolean;
  // 専用マスタノードの有無
  readonly dedicatedMaster: boolean;
  // データ暗号化の有無
  readonly encryption: boolean;
}

class ESDomainStack extends cdk.Stack {
  // LambdaなどからElasticsearch Serviceエンドポイントを参照できるようにする
  public endpoint: string;

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // cdkコマンドで、-c stage=devのように、devやprodを指定する
    const stage: string = this.node.tryGetContext('stage');
    // Elasticsearchのバージョン
    const esVersion: string = this.node.tryGetContext('es').version;
    // cdk.jsonからesコンテキストのオブジェクトを取得する
    const esContext: ESContext = this.node.tryGetContext(stage).es;
    // アクセスポリシー設定のため、cdk deployコマンド実行時にパラメーターで自身のIPを渡す -c sourceIp=`curl -s https://checkip.amazonaws.com`
    const sourceIp: string = this.node.tryGetContext('sourceIp');

    const domain = new CfnDomain(this, esContext.domainName || 'domain', {
      accessPolicies: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              AWS: [
                '*'
              ]
            },
            Action: [
              'es:*'
            ],
            Resource: `arn:aws:es:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:domain/${esContext.domainName}/*`,
            Condition: {
              IpAddress: {
                // 自身のIPからElasticsearchやKibanaのエンドポイントにアクセスできるようにする
                'aws:SourceIp': `${sourceIp || '127.0.0.1'}`
              }
            }
          },
          {
            Effect: 'Allow',
            Principal: {
              AWS: [
                // 自身のAWSアカウント環境からのElasticsearchへの操作を許可する
                cdk.Stack.of(this).account
              ]
            },
            Action: [
              'es:*'
            ],
            Resource: `arn:aws:es:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:domain/${esContext.domainName}/*`
          }
        ]
      },
      domainName: esContext.domainName,
      ebsOptions: {
        ebsEnabled: true,
        volumeSize: esContext.volumeSize,
        volumeType: 'gp2',
      },
      elasticsearchClusterConfig: {
        instanceCount: esContext.instanceCount,
        // T2 インスタンスタイプは、保管時のデータの暗号化をサポートしていない
        // https://docs.aws.amazon.com/ja_jp/elasticsearch-service/latest/developerguide/aes-supported-instance-types.html
        instanceType: esContext.instanceType,
        // 専用マスターノードを使う構成にしたい場合は以下のオプションを設定する
        // dedicatedMasterEnabled: true,
        // dedicatedMasterCount: 3,
        // dedicatedMasterType: esContext.masterInstanceType,
        // zoneAwarenessEnabled: true,
        // zoneAwarenessConfig: {
        //   availabilityZoneCount: esContext.availabilityZoneCount
        // }
      },
      elasticsearchVersion: esVersion,
      encryptionAtRestOptions: {
        enabled: esContext.encryption
        // kmsKeyId: ''
      },
      nodeToNodeEncryptionOptions: {
        enabled: false
      },
      snapshotOptions: {
        automatedSnapshotStartHour: 0
      },
      // tags: [],
      // vpcOptions: {
      //   subnetIds: [],
      //   securityGroupIds: []
      // },
    });

    this.endpoint = domain.attrDomainEndpoint;
  }
}

const app = new cdk.App();
new ESDomainStack(app, 'ESDomainStack');
