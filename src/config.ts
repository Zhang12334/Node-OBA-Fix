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

  public readonly sslKey = env.get('SSL_KEY').asString()
  public readonly sslCert = env.get('SSL_CERT').asString()

  public readonly restartProcess = env.get('RESTART_PROCESS').asBool()
  public readonly noENABLE = env.get('CLUSTER_NO_ENABLE').asBool()
  public readonly flavor: IConfigFlavor

  public readonly protocol_version = packageJson.protocol_version
  public readonly version = packageJson.version
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
