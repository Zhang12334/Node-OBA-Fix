import colors from 'colors/safe.js'
import type {Request, Response} from 'express'
import Keyv from 'keyv'
import ms from 'ms'
import {Agent} from 'node:https'
import pMap from 'p-map'
import {join} from 'path'
import {createClient, type FileStat, type WebDAVClient, type ResponseDataDetailed} from 'webdav'
import {z} from 'zod'
import {fromZodError} from 'zod-validation-error'
import {logger} from '../logger.js'
import {IFileInfo, IGCCounter} from '../types.js'
import {getSize} from '../util.js'
import type {IStorage} from './base.storage.js'

const storageConfigSchema = z.object({
  url: z.string(),
  username: z.string().optional(),
  password: z.string().optional(),
  basePath: z.string(),
})

export class WebdavStorage implements IStorage {
  public static readonly configSchema = storageConfigSchema
  protected readonly client: WebDAVClient
  protected readonly storageConfig: z.infer<typeof storageConfigSchema>
  protected readonly basePath: string

  /** Map<hash, FileInfo> */
  protected files = new Map<string, {size: number; path: string}>()
  protected emptyFiles = new Set<string>()

  protected existsCache = new Keyv({
    ttl: ms('1h'),
  })

  constructor(storageConfig: unknown) {
    try {
      this.storageConfig = storageConfigSchema.parse(storageConfig)
    } catch (e) {
      if (e instanceof z.ZodError) {
        throw new Error('webdav存储选项无效', {cause: fromZodError(e)})
      } else {
        throw new Error('webdav存储选项无效', {cause: e})
      }
    }
    this.client = createClient(this.storageConfig.url, {
      username: this.storageConfig.username,
      password: this.storageConfig.password,
      httpsAgent: new Agent({rejectUnauthorized: false}),
    })
    this.basePath = this.storageConfig.basePath
  }

  public async init(): Promise<void> {
    if (!(await this.client.exists(this.basePath))) {
      logger.info(`已创建路径: ${this.basePath}`)
      await this.client.createDirectory(this.basePath, {recursive: true})
    }
  }

  public getAbsolutePath(path: string): string {
    return this.client.getFileDownloadLink(join(this.basePath, path))
  }

  public async check(): Promise<boolean> {
    try {
      await this.client.putFileContents(join(this.basePath, '.check'), Buffer.from(Date.now().toString()))
      return true
    } catch (e) {
      logger.error(e, '存储检查异常')
      return false
    } finally {
      try {
        await this.client.deleteFile(join(this.basePath, '.check'))
      } catch (e) {
        logger.warn(e, '删除临时文件失败')
      }
    }
  }

  public async writeFile(path: string, content: Buffer, fileInfo: IFileInfo): Promise<void> {
    if (content.length === 0) {
      this.emptyFiles.add(path)
      return
    }
    await this.client.putFileContents(join(this.basePath, path), content)
    this.files.set(fileInfo.hash, {size: content.length, path: fileInfo.path})
  }

  public async exists(path: string): Promise<boolean> {
    if (await this.existsCache.has(path)) {
      return true
    }
    const exists = await this.client.exists(join(this.basePath, path))
    if (exists) {
      await this.existsCache.set(path, true)
    }
    return exists
  }

  public async getMissingFiles<T extends {path: string; hash: string; size: number}>(files: T[]): Promise<T[]> {
    const remoteFileList = new Map(files.map((file) => [file.hash, file]))
    if (this.files.size !== 0) {
      for (const hash of this.files.keys()) {
        remoteFileList.delete(hash)
      }
      return [...remoteFileList.values()]
    }
    let queue = [this.basePath]
    let count = 1
    let cur = 0

    while (queue.length !== 0) {
      const nextQueue = [] as string[]
      await pMap(
        queue,
        // eslint-disable-next-line no-loop-func
        async (dir) => {
          const entries = (await this.client.getDirectoryContents(dir)) as FileStat[]
          entries.sort((a, b) => a.basename.localeCompare(b.basename))
          logger.trace(`checking ${dir}, (${++cur}/${count})`)
          for (const entry of entries) {
            if (entry.type === 'directory') {
              nextQueue.push(entry.filename)
              count++
              continue
            }
            const file = remoteFileList.get(entry.basename)
            if (file && file.size === entry.size) {
              this.files.set(entry.basename, {size: entry.size, path: entry.filename})
              remoteFileList.delete(entry.basename)
            }
          }
        },
        {
          concurrency: 10,
        },
      )
      queue = nextQueue
    }
    return [...remoteFileList.values()]
  }

  public async gc(files: {path: string; hash: string; size: number}[]): Promise<IGCCounter> {
    const counter = {count: 0, size: 0};
    const fileSet = new Set<string>();
    for (const file of files) {
        fileSet.add(file.hash);
    }
    const queue = [this.basePath];
    do {
        const dir = queue.pop();
        if (!dir) break;
        if (dir.includes('/measure/') || dir.endsWith('/measure')) {
            continue; // 跳过 measure
        }
        const entries = (await this.client.getDirectoryContents(dir)) as FileStat[];
        entries.sort((a, b) => a.basename.localeCompare(b.basename));
        for (const entry of entries) {
            if (entry.type === 'directory') {
                queue.push(entry.filename);
                continue;
            }
            if (!fileSet.has(entry.basename)) {
                logger.info(colors.gray(`已删除临时文件: ${entry.filename}`));
                await this.client.deleteFile(entry.filename);
                this.files.delete(entry.basename);
                counter.count++;
                counter.size += entry.size;
            }
        }
    } while (queue.length !== 0);
    return counter;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async express(hashPath: string, req: Request, res: Response): Promise<{bytes: number; hits: number}> {
    if (this.emptyFiles.has(hashPath)) {
      res.end()
      return {bytes: 0, hits: 1}
    }
    const path = join(this.basePath, hashPath)
    const file = this.client.getFileDownloadLink(path)
    res.redirect(file)

    // 如果 this.files 中没有文件信息，尝试从存储中获取文件大小
    let size = this.files.get(hashPath)?.size ?? 0;
    if (size === 0) {
      try {
        const fileStat = await this.client.stat(path);
        // 处理 ResponseDataDetailed<FileStat> 的情况
        size = (fileStat as ResponseDataDetailed<FileStat>).data?.size ?? (fileStat as FileStat).size;
      } catch (e) {
        logger.error(e, '无法获取文件大小');
      }
    }
    const totalSize = getSize(size, req.headers.range)
    return {bytes: totalSize, hits: 1}
  }
}
