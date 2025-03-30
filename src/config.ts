import dotenv from 'dotenv'
import {z} from 'zod'
import env from 'env-var'
import {readFileSync} from 'fs'
import {fileURLToPath} from 'url'

export interface IConfigFlavor {
  runtime: string
  storage: string
}
const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  protocol_version: string
  version: string
}

export class Config {
  public static instance: Config

  // 节点本体相关
  public readonly clusterId = env.get('CLUSTER_ID').required().asString()
  public readonly clusterSecret = env.get('CLUSTER_SECRET').required().asString()
  public readonly clusterIp? = env.get('CLUSTER_IP').asString()
  public readonly port: number = env.get('CLUSTER_PORT').default(4000).asPortNumber()
  public readonly clusterPublicPort = env.get('CLUSTER_PUBLIC_PORT').default(this.port).asPortNumber()
  public readonly byoc = env.get('CLUSTER_BYOC').asBool()
  public readonly disableAccessLog = env.get('DISABLE_ACCESS_LOG').asBool()

  public readonly enableNginx = env.get('ENABLE_NGINX').asBool()
  public readonly enableUpnp = env.get('ENABLE_UPNP').asBool()
  public readonly storage = env.get('CLUSTER_STORAGE').default('file').asString()
  public readonly storageOpts = env.get('CLUSTER_STORAGE_OPTIONS').asJsonObject()

  public readonly restartProcess = env.get('RESTART_PROCESS').asBool()
  public readonly noENABLE = env.get('CLUSTER_NO_ENABLE').asBool()
  public readonly noConnect = env.get('NO_CONNECT').asBool()  

  public readonly clusterName = env.get('CLUSTER_NAME').asString()

  // SSL
  public readonly sslKey = env.get('SSL_KEY').asString()
  public readonly sslCert = env.get('SSL_CERT').asString()

  public readonly flavor: IConfigFlavor
  
  // 版本
  public readonly protocol_version = packageJson.protocol_version
  public readonly version = packageJson.version

  // 更新
  public readonly enableAutoUpdate = env.get('ENABLE_AUTO_UPDATE').asBool()

  // 同步设置项
  public readonly syncConcurrency = env.get('SYNC_CONCURRENCY').default(10).asInt()
  public readonly disableSyncFiles = env.get('DISABLE_SYNC_FILES').asBool()

  // 视觉配置项
  public readonly disableOptiLog = env.get('DISABLE_OPTI_LOG').asBool()
  public readonly disableNewSyncStatus = env.get('DISABLE_NEW_SYNC_STATUS').asBool()

  // webhook 配置项
  public readonly enableWebhookReconnect = env.get('WEBHOOK_RECONNECT').asBool()
  public readonly enableWebhookStartUP = env.get('WEBHOOK_STARTUP').asBool()
  public readonly enableWebhookShutdown = env.get('WEBHOOK_SHUTDOWN').asBool()
  public readonly enableWebhookError = env.get('WEBHOOK_ERROR').asBool()

  public readonly WebhookReconnectMessage = env.get('WEBHOOK_RECONNECT_MESSAGE').asString()
  public readonly WebhookStartUPMessage = env.get('WEBHOOK_STARTUP_MESSAGE').asString()
  public readonly WebhookShutdownMessage = env.get('WEBHOOK_SHUTDOWN_MESSAGE').asString()
  public readonly WebhookErrorMessage = env.get('WEBHOOK_ERROR_MESSAGE').asString()

  public readonly webhookUrl = env.get('WEBHOOK_URL').asString()

  private constructor() {
    this.flavor = {
      runtime: `Node.js/${process.version}`,
      storage: this.storage,
    }
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config()
    }
    return Config.instance
  }
}

export const OpenbmclapiAgentConfigurationSchema = z.object({
  sync: z.object({
    source: z.string(),
    concurrency: z.number(),
  }),
})

export type OpenbmclapiAgentConfiguration = z.infer<typeof OpenbmclapiAgentConfigurationSchema>

dotenv.config()

export const config = Config.getInstance()
